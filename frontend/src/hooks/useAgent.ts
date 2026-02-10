import { useState, useEffect, useCallback } from 'react';
import {
  Agent,
  AgentScore,
  Feedback,
  TrustScore,
  getAgent,
  getAgentScore,
  getAgentFeedback,
  getKycLevel,
  getSystemStake,
  calculateTrustScore,
} from '@/lib/registry';

interface UseAgentResult {
  agent: Agent | null;
  score: AgentScore | null;
  trustScore: TrustScore | null;
  feedback: Feedback[];
  kycLevel: number;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export function useAgent(account: string | undefined): UseAgentResult {
  const [agent, setAgent] = useState<Agent | null>(null);
  const [score, setScore] = useState<AgentScore | null>(null);
  const [trustScore, setTrustScore] = useState<TrustScore | null>(null);
  const [feedback, setFeedback] = useState<Feedback[]>([]);
  const [kycLevel, setKycLevel] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    if (!account) return;

    setLoading(true);
    setError(null);

    try {
      const [agentData, scoreData, feedbackData, kyc, stake] = await Promise.all([
        getAgent(account),
        getAgentScore(account),
        getAgentFeedback(account),
        getKycLevel(account),
        getSystemStake(account),
      ]);

      setAgent(agentData);
      setScore(scoreData);
      setFeedback(feedbackData);
      setKycLevel(kyc);

      if (agentData) {
        setTrustScore(calculateTrustScore(agentData, scoreData, kyc, stake));
      }
    } catch (e: any) {
      setError(e.message || 'Failed to fetch agent data');
    } finally {
      setLoading(false);
    }
  }, [account]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return {
    agent,
    score,
    trustScore,
    feedback,
    kycLevel,
    loading,
    error,
    refresh: fetchData,
  };
}
