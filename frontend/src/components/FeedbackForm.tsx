import { useState } from 'react';
import { useFeedback } from '@/hooks/useFeedback';
import { useProton } from '@/hooks/useProton';

interface FeedbackFormProps {
  agentAccount: string;
  onSuccess?: () => void;
}

const COMMON_TAGS = ['helpful', 'fast', 'accurate', 'reliable', 'professional', 'slow', 'inaccurate', 'unresponsive'];

export function FeedbackForm({ agentAccount, onSuccess }: FeedbackFormProps) {
  const { session } = useProton();
  const { submitFeedback, submitting, error, feedbackFee } = useFeedback();

  const [score, setScore] = useState(5);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [jobHash, setJobHash] = useState('');
  const [evidenceUri, setEvidenceUri] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);

  const handleTagToggle = (tag: string) => {
    setSelectedTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError(null);

    if (!session) {
      setLocalError('Please connect your wallet first');
      return;
    }

    if (session.auth.actor === agentAccount) {
      setLocalError('You cannot review yourself');
      return;
    }

    const success = await submitFeedback({
      agent: agentAccount,
      score,
      tags: selectedTags,
      job_hash: jobHash || undefined,
      evidence_uri: evidenceUri || undefined,
    });

    if (success) {
      setScore(5);
      setSelectedTags([]);
      setJobHash('');
      setEvidenceUri('');
      onSuccess?.();
    }
  };

  return (
    <form onSubmit={handleSubmit} className="bg-surface border border-line rounded-xl p-4">
      <h3 className="text-lg font-semibold text-ink mb-4">Leave Feedback</h3>

      {(error || localError) && (
        <div className="mb-4 p-3 bg-red-50 text-red-600 rounded-lg text-sm">
          {error || localError}
        </div>
      )}

      <div className="mb-4">
        <label className="block text-sm font-medium text-ink-2 mb-2">
          Rating
        </label>
        <div className="flex gap-2">
          {[1, 2, 3, 4, 5].map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setScore(value)}
              className={`w-10 h-10 rounded-full border-2 transition-colors ${
                score >= value
                  ? 'bg-yellow-400 border-yellow-500 text-ink'
                  : 'bg-surface-2 border-line-2 text-muted'
              }`}
            >
              {value}
            </button>
          ))}
        </div>
      </div>

      <div className="mb-4">
        <label className="block text-sm font-medium text-ink-2 mb-2">
          Tags (optional)
        </label>
        <div className="flex flex-wrap gap-2">
          {COMMON_TAGS.map((tag) => (
            <button
              key={tag}
              type="button"
              onClick={() => handleTagToggle(tag)}
              className={`px-3 py-1 rounded-full text-sm transition-colors ${
                selectedTags.includes(tag)
                  ? 'bg-accent text-white'
                  : 'bg-surface-2 text-ink-2 hover:bg-line'
              }`}
            >
              {tag}
            </button>
          ))}
        </div>
      </div>

      <div className="mb-4">
        <label className="block text-sm font-medium text-ink-2 mb-2">
          Job Hash (optional)
        </label>
        <input
          type="text"
          value={jobHash}
          onChange={(e) => setJobHash(e.target.value)}
          placeholder="Transaction or job hash"
          className="w-full px-3 py-2 bg-surface-2 border border-line-2 text-ink placeholder:text-muted rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-accent"
        />
      </div>

      <div className="mb-4">
        <label className="block text-sm font-medium text-ink-2 mb-2">
          Evidence URI (optional)
        </label>
        <input
          type="text"
          value={evidenceUri}
          onChange={(e) => setEvidenceUri(e.target.value)}
          placeholder="IPFS or Arweave link"
          className="w-full px-3 py-2 bg-surface-2 border border-line-2 text-ink placeholder:text-muted rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-accent"
        />
      </div>

      <button
        type="submit"
        disabled={submitting || !session}
        className="w-full py-2 bg-accent text-white rounded-lg hover:bg-accent-hover transition-colors disabled:bg-line disabled:text-muted disabled:cursor-not-allowed"
      >
        {submitting
          ? 'Submitting...'
          : feedbackFee > 0
            ? `Submit Feedback (${(feedbackFee / 10000).toFixed(4)} XPR fee)`
            : 'Submit Feedback'}
      </button>

      {!session && (
        <p className="mt-2 text-xs text-muted text-center">
          Connect your wallet to submit feedback
        </p>
      )}
    </form>
  );
}
