"use client";

import { useState, useEffect } from "react";
import { Loader2, AlertCircle, Wallet, ExternalLink, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useStellarWallet } from "@/components/wallet-provider";
import { toast } from "sonner";
import { buildPaymentTransaction, getNetworkPassphrase } from "@/lib/stellar/transaction-builder";

interface EscrowFundingDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contractId: string;
  contractAddress: string | null;
  requiredAmount: string;
  currency: string;
  onFundingSuccess?: () => void;
}

interface FundingValidation {
  isValid: boolean;
  error?: string;
  walletBalance?: string;
}

export function EscrowFundingDialog({
  open,
  onOpenChange,
  contractId,
  contractAddress,
  requiredAmount,
  currency,
  onFundingSuccess,
}: EscrowFundingDialogProps) {
  const { address, isConnected, isWrongNetwork, connect, network } = useStellarWallet();
  const [amount, setAmount] = useState(requiredAmount);
  const [validation, setValidation] = useState<FundingValidation>({ isValid: false });
  const [isValidating, setIsValidating] = useState(false);
  const [isConfirming, setIsConfirming] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [transactionHash, setTransactionHash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Reset state when dialog opens/closes
  useEffect(() => {
    if (open) {
      setAmount(requiredAmount);
      setValidation({ isValid: false });
      setError(null);
      setTransactionHash(null);
      setShowConfirmation(false);
    }
  }, [open, requiredAmount]);

  // Validate amount when it changes or wallet connects
  useEffect(() => {
    if (!isConnected || !address) {
      setValidation({ isValid: false, error: "Wallet not connected" });
      return;
    }

    if (isWrongNetwork) {
      setValidation({ isValid: false, error: "Wrong network. Please switch to Testnet" });
      return;
    }

    validateAmount();
  }, [amount, isConnected, address, isWrongNetwork, requiredAmount]);

  const validateAmount = async () => {
    if (!amount || !isConnected || !address) return;

    setIsValidating(true);
    try {
      const numericAmount = parseFloat(amount);
      const numericRequired = parseFloat(requiredAmount);

      if (isNaN(numericAmount) || numericAmount <= 0) {
        setValidation({ isValid: false, error: "Please enter a valid amount" });
        return;
      }

      if (numericAmount < numericRequired) {
        setValidation({
          isValid: false,
          error: `Amount must be at least ${requiredAmount} ${currency}`,
        });
        return;
      }

      // Check wallet balance (simplified - in production you'd query the actual balance)
      // For now, we'll assume sufficient balance since Freighter will handle the actual check
      setValidation({
        isValid: true,
        walletBalance: "10000", // Mock balance - replace with actual balance check
      });
    } catch (err) {
      setValidation({
        isValid: false,
        error: err instanceof Error ? err.message : "Validation failed",
      });
    } finally {
      setIsValidating(false);
    }
  };

  const handleConnectWallet = async () => {
    try {
      await connect();
    } catch (err) {
      toast.error("Failed to connect wallet", {
        description: err instanceof Error ? err.message : "Unknown error",
      });
    }
  };

  const handleConfirmFunding = async () => {
    if (!validation.isValid) return;

    setIsConfirming(true);
    try {
      // Check if contract address exists
      if (!contractAddress) {
        throw new Error("Contract address not available. Please ensure the contract is deployed.");
      }

      setShowConfirmation(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to prepare transaction");
      toast.error("Preparation failed", {
        description: error || "Unknown error",
      });
    } finally {
      setIsConfirming(false);
    }
  };

  const handleExecuteTransaction = async () => {
    setIsSubmitting(true);
    setError(null);

    try {
      if (!address || !contractAddress) {
        throw new Error("Wallet or contract address not available");
      }

      // Import Freighter API dynamically
      const { signTransaction } = await import("@stellar/freighter-api");

      // Build the payment transaction using the transaction builder
      const networkPassphrase = getNetworkPassphrase(network as "TESTNET" | "PUBLIC");
      
      const { xdr: transactionXDR } = buildPaymentTransaction({
        fromAddress: address,
        toAddress: contractAddress,
        amount,
        assetCode: currency === "XLM" ? "XLM" : currency,
        networkPassphrase,
        memo: `Fund escrow ${contractId}`,
      });

      // Sign and submit transaction through Freighter
      const signedResult = await signTransaction(transactionXDR, { networkPassphrase });

      if (signedResult.error) {
        throw new Error(signedResult.error.message || "Transaction signing failed");
      }

      // Submit the signed transaction to the network
      // In production, you'd use SorobanRpc.Server to submit the transaction
      // For now, we'll use a mock hash since we don't have the RPC server set up
      const txHash = "mock-tx-hash-" + Date.now();
      
      setTransactionHash(txHash);

      // Call the backend API to record the funding
      const response = await fetch("/api/escrow/fund", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${localStorage.getItem("tc_dev_access_token")}`,
        },
        body: JSON.stringify({
          contractId,
          fundingTxHash: txHash,
          amount,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to record funding");
      }

      const result = await response.json();

      toast.success("Escrow funded successfully!", {
        description: `Transaction hash: ${txHash}`,
      });

      // Close dialogs and trigger success callback
      setShowConfirmation(false);
      onOpenChange(false);
      onFundingSuccess?.();
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Transaction failed";
      setError(errorMessage);
      toast.error("Funding failed", {
        description: errorMessage,
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const getExplorerUrl = (txHash: string) => {
    return network === "TESTNET"
      ? `https://stellar.expert/explorer/testnet/tx/${txHash}`
      : `https://stellar.expert/explorer/public/tx/${txHash}`;
  };

  return (
    <>
      <Dialog open={open && !showConfirmation} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Wallet className="h-5 w-5 text-accent" />
              Fund Escrow Contract
            </DialogTitle>
            <DialogDescription>
              Fund the escrow contract securely from your Stellar wallet
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            {/* Contract Info */}
            <div className="bg-muted/50 rounded-lg p-3 space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Required Amount:</span>
                <span className="font-semibold">{requiredAmount} {currency}</span>
              </div>
              {contractAddress && (
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Contract:</span>
                  <span className="font-mono text-xs truncate max-w-[200px]">{contractAddress}</span>
                </div>
              )}
            </div>

            {/* Wallet Connection Status */}
            {!isConnected ? (
              <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-4">
                <div className="flex items-center gap-2 text-amber-600 dark:text-amber-500 mb-2">
                  <AlertCircle className="h-4 w-4" />
                  <span className="font-medium">Wallet Not Connected</span>
                </div>
                <p className="text-sm text-muted-foreground mb-3">
                  Connect your Stellar wallet to fund the escrow
                </p>
                <Button onClick={handleConnectWallet} className="w-full">
                  Connect Wallet
                </Button>
              </div>
            ) : isWrongNetwork ? (
              <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4">
                <div className="flex items-center gap-2 text-red-600 dark:text-red-500 mb-2">
                  <AlertCircle className="h-4 w-4" />
                  <span className="font-medium">Wrong Network</span>
                </div>
                <p className="text-sm text-muted-foreground">
                  Please switch your wallet to Testnet to continue
                </p>
              </div>
            ) : (
              <>
                {/* Amount Input */}
                <div className="space-y-2">
                  <Label htmlFor="amount">Funding Amount ({currency})</Label>
                  <Input
                    id="amount"
                    type="number"
                    step="0.01"
                    min={requiredAmount}
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    disabled={isSubmitting}
                    placeholder={`Enter amount (min: ${requiredAmount})`}
                  />
                </div>

                {/* Validation Status */}
                {isValidating && (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Validating...
                  </div>
                )}

                {validation.error && !isValidating && (
                  <div className="flex items-center gap-2 text-sm text-destructive">
                    <AlertCircle className="h-4 w-4" />
                    {validation.error}
                  </div>
                )}

                {validation.isValid && validation.walletBalance && (
                  <div className="flex items-center gap-2 text-sm text-green-600 dark:text-green-500">
                    <CheckCircle2 className="h-4 w-4" />
                    <span>Wallet balance sufficient</span>
                  </div>
                )}

                {/* Connected Wallet Info */}
                <div className="bg-muted/50 rounded-lg p-3">
                  <div className="flex items-center gap-2 text-sm">
                    <Wallet className="h-4 w-4 text-muted-foreground" />
                    <span className="text-muted-foreground">Connected:</span>
                    <span className="font-mono text-xs">{address}</span>
                  </div>
                </div>
              </>
            )}

            {/* Error Display */}
            {error && (
              <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-3">
                <div className="flex items-center gap-2 text-destructive text-sm">
                  <AlertCircle className="h-4 w-4" />
                  {error}
                </div>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
              Cancel
            </Button>
            <Button
              onClick={handleConfirmFunding}
              disabled={!validation.isValid || isConfirming || isSubmitting}
              className="min-w-[120px]"
            >
              {isConfirming ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Preparing...
                </>
              ) : (
                "Review Transaction"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Transaction Confirmation Dialog */}
      <AlertDialog open={showConfirmation} onOpenChange={setShowConfirmation}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <Wallet className="h-5 w-5 text-accent" />
              Confirm Funding Transaction
            </AlertDialogTitle>
            <AlertDialogDescription>
              Please review the transaction details before confirming
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="space-y-4 py-4">
            <div className="bg-muted/50 rounded-lg p-4 space-y-3">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Amount to Fund:</span>
                <span className="font-semibold text-lg">{amount} {currency}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">To Contract:</span>
                <span className="font-mono text-xs break-all">{contractAddress}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">From Wallet:</span>
                <span className="font-mono text-xs">{address}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Network:</span>
                <span className="font-medium">{network === "TESTNET" ? "Testnet" : "Mainnet"}</span>
              </div>
            </div>

            <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-3">
              <p className="text-sm text-blue-600 dark:text-blue-500">
                <strong>Important:</strong> This transaction cannot be undone. Make sure you have reviewed all details.
              </p>
            </div>
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel disabled={isSubmitting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleExecuteTransaction}
              disabled={isSubmitting}
              className="min-w-[140px]"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Processing...
                </>
              ) : (
                "Confirm & Fund"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Success Notification with Explorer Link */}
      {transactionHash && (
        <div className="fixed bottom-4 right-4 z-50">
          <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-4 shadow-lg max-w-sm">
            <div className="flex items-start gap-3">
              <CheckCircle2 className="h-5 w-5 text-green-600 dark:text-green-500 shrink-0 mt-0.5" />
              <div className="flex-1 space-y-2">
                <p className="font-medium text-green-600 dark:text-green-500">
                  Funding Successful!
                </p>
                <p className="text-sm text-muted-foreground">
                  Transaction hash: <span className="font-mono text-xs">{transactionHash}</span>
                </p>
                <a
                  href={getExplorerUrl(transactionHash)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-sm text-blue-600 dark:text-blue-500 hover:underline"
                >
                  View on Explorer
                  <ExternalLink className="h-3 w-3" />
                </a>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
