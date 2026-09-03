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
  // Preview on hover/focus so the whole row lights up to the star under the cursor.
  const [hoverScore, setHoverScore] = useState(0);
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
        <div className="mb-4 p-3 bg-crit-soft text-crit rounded-lg text-sm">
          {error || localError}
        </div>
      )}

      <div className="mb-4">
        <label className="block text-sm font-medium text-ink-2 mb-2">
          Rating
        </label>
        <div
          role="radiogroup"
          aria-label="Rating out of 5"
          className="flex items-center gap-1"
          onMouseLeave={() => setHoverScore(0)}
        >
          {[1, 2, 3, 4, 5].map((value) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={score === value}
              aria-label={`${value} out of 5`}
              onClick={() => setScore(value)}
              onMouseEnter={() => setHoverScore(value)}
              onFocus={() => setHoverScore(value)}
              onBlur={() => setHoverScore(0)}
              className="rounded p-0.5 transition-transform hover:scale-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              <svg
                viewBox="0 0 24 24"
                aria-hidden="true"
                fill="currentColor"
                className={`h-7 w-7 transition-colors ${
                  (hoverScore || score) >= value ? 'text-warn' : 'text-line-2'
                }`}
              >
                <path d="M12 2.6l2.94 5.96 6.58.96-4.76 4.64 1.12 6.55L12 17.6l-5.88 3.09 1.12-6.55L2.48 9.5l6.58-.96L12 2.6z" />
              </svg>
            </button>
          ))}
          <span className="ml-2 font-mono text-sm tabular-nums text-ink-2">{score}/5</span>
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
