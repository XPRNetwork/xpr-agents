import { useProton } from '@/contexts/ProtonContext';

interface SubscriptionCardProps {
  agentAccount: string;
  tokenSymbol: string;
  tokenContract: string;
  amount: string;
  onRenewed?: () => void;
}

export function SubscriptionCard({ agentAccount, tokenSymbol, tokenContract, amount, onRenewed }: SubscriptionCardProps) {
  const { transact, session } = useProton();

  const handleRenew = async () => {
    if (!session) return;

    try {
      await transact([
        {
          account: tokenContract,
          name: 'transfer',
          data: {
            from: session.auth.actor,
            to: 'agentdeploy',
            quantity: amount,
            memo: `sub:${agentAccount}`,
          },
        },
      ]);

      onRenewed?.();
    } catch (e: any) {
      alert(`Renewal failed: ${e.message}`);
    }
  };

  return (
    <div className="card">
      <h3 className="font-medium mb-3">Renew Subscription</h3>
      <p className="text-sm text-gray-400 mb-4">
        Send <span className="text-white font-medium">{amount}</span> to extend your subscription by 30 days.
      </p>
      <button onClick={handleRenew} className="btn-primary w-full" disabled={!session}>
        Pay {amount}
      </button>
    </div>
  );
}
