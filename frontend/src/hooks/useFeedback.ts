import { useState, useCallback, useEffect } from 'react';
import { useProton } from './useProton';
import { CONTRACTS, rpc } from '@/lib/registry';

interface SubmitFeedbackData {
  agent: string;
  score: number;
  tags?: string[];
  job_hash?: string;
  evidence_uri?: string;
  amount_paid?: number;
}

interface UseFeedbackResult {
  submitting: boolean;
  error: string | null;
  feedbackFee: number;
  submitFeedback: (data: SubmitFeedbackData) => Promise<boolean>;
  disputeFeedback: (feedbackId: number, reason: string, evidenceUri?: string) => Promise<boolean>;
}

export function useFeedback(): UseFeedbackResult {
  const { session, transact } = useProton();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feedbackFee, setFeedbackFee] = useState(0);

  useEffect(() => {
    rpc.get_table_rows({
      json: true,
      code: CONTRACTS.AGENT_FEED,
      scope: CONTRACTS.AGENT_FEED,
      table: 'config',
      limit: 1,
    }).then((result) => {
      if (result.rows.length > 0) {
        setFeedbackFee(parseInt(result.rows[0].feedback_fee) || 0);
      }
    }).catch(() => {});
  }, []);

  const submitFeedback = useCallback(
    async (data: SubmitFeedbackData): Promise<boolean> => {
      if (!session) {
        setError('Please login first');
        return false;
      }

      setSubmitting(true);
      setError(null);

      try {
        const actions: any[] = [];

        if (feedbackFee > 0) {
          actions.push({
            account: 'eosio.token',
            name: 'transfer',
            data: {
              from: session.auth.actor,
              to: CONTRACTS.AGENT_FEED,
              quantity: `${(feedbackFee / 10000).toFixed(4)} XPR`,
              memo: `feedfee:${session.auth.actor}`,
            },
          });
        }

        actions.push({
          account: CONTRACTS.AGENT_FEED,
          name: 'submit',
          data: {
            reviewer: session.auth.actor,
            agent: data.agent,
            score: data.score,
            tags: (data.tags || []).join(','),
            job_hash: data.job_hash || '',
            evidence_uri: data.evidence_uri || '',
            amount_paid: data.amount_paid || 0,
          },
        });

        await transact(actions);

        return true;
      } catch (e: any) {
        setError(e.message || 'Failed to submit feedback');
        return false;
      } finally {
        setSubmitting(false);
      }
    },
    [session, transact, feedbackFee]
  );

  const disputeFeedback = useCallback(
    async (feedbackId: number, reason: string, evidenceUri?: string): Promise<boolean> => {
      if (!session) {
        setError('Please login first');
        return false;
      }

      setSubmitting(true);
      setError(null);

      try {
        await transact([
          {
            account: CONTRACTS.AGENT_FEED,
            name: 'dispute',
            data: {
              disputer: session.auth.actor,
              feedback_id: feedbackId,
              reason,
              evidence_uri: evidenceUri || '',
            },
          },
        ]);

        return true;
      } catch (e: any) {
        setError(e.message || 'Failed to dispute feedback');
        return false;
      } finally {
        setSubmitting(false);
      }
    },
    [session, transact]
  );

  return {
    submitting,
    error,
    feedbackFee,
    submitFeedback,
    disputeFeedback,
  };
}
