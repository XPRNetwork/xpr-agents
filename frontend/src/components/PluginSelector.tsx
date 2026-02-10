import { useState, useEffect } from 'react';
import { rpc, CONTRACTS } from '@/lib/registry';

interface Plugin {
  id: number;
  name: string;
  version: string;
  contract: string;
  category: string;
  author: string;
  verified: boolean;
}

interface PluginSelectorProps {
  onSelect: (plugin: Plugin) => void;
  selectedIds?: number[];
}

const CATEGORY_LABELS: Record<string, string> = {
  compute: 'Compute',
  storage: 'Storage',
  oracle: 'Oracle',
  payment: 'Payment',
  messaging: 'Messaging',
  ai: 'AI/ML',
};

export function PluginSelector({ onSelect, selectedIds = [] }: PluginSelectorProps) {
  const [plugins, setPlugins] = useState<Plugin[]>([]);
  const [loading, setLoading] = useState(true);
  const [category, setCategory] = useState<string>('all');

  useEffect(() => {
    const fetchPlugins = async () => {
      try {
        const result = await rpc.get_table_rows({
          json: true,
          code: CONTRACTS.AGENT_CORE,
          scope: CONTRACTS.AGENT_CORE,
          table: 'plugins',
          limit: 100,
        });

        setPlugins(
          result.rows.map((row: any) => ({
            id: parseInt(row.id),
            name: row.name,
            version: row.version,
            contract: row.contract,
            category: row.category,
            author: row.author,
            verified: row.verified === 1,
          }))
        );
      } catch (e) {
        console.error('Failed to fetch plugins:', e);
      } finally {
        setLoading(false);
      }
    };

    fetchPlugins();
  }, []);

  const filteredPlugins = plugins.filter(
    (p) => category === 'all' || p.category === category
  );

  if (loading) {
    return (
      <div className="animate-pulse space-y-2">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-16 bg-zinc-800 rounded-lg"></div>
        ))}
      </div>
    );
  }

  return (
    <div>
      <div className="flex gap-2 mb-4 overflow-x-auto pb-2">
        <button
          onClick={() => setCategory('all')}
          className={`px-3 py-1 rounded-lg text-sm whitespace-nowrap ${
            category === 'all'
              ? 'bg-proton-purple text-white'
              : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'
          }`}
        >
          All
        </button>
        {Object.entries(CATEGORY_LABELS).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setCategory(key)}
            className={`px-3 py-1 rounded-lg text-sm whitespace-nowrap ${
              category === key
                ? 'bg-proton-purple text-white'
                : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {filteredPlugins.length === 0 ? (
        <div className="text-center py-8 text-zinc-500">
          <p>No plugins available</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filteredPlugins.map((plugin) => (
            <div
              key={plugin.id}
              onClick={() => !selectedIds.includes(plugin.id) && onSelect(plugin)}
              className={`p-3 border rounded-lg cursor-pointer transition-colors ${
                selectedIds.includes(plugin.id)
                  ? 'border-proton-purple bg-proton-purple/10'
                  : 'border-zinc-800 hover:border-zinc-700 hover:bg-zinc-800'
              }`}
            >
              <div className="flex justify-between items-start">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-white">{plugin.name}</span>
                    <span className="text-xs text-zinc-600">v{plugin.version}</span>
                    {plugin.verified && (
                      <span className="text-xs bg-emerald-500/10 text-emerald-400 px-2 py-0.5 rounded-full">
                        Verified
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-zinc-500">
                    {CATEGORY_LABELS[plugin.category] || plugin.category} · by @{plugin.author}
                  </p>
                </div>
                {selectedIds.includes(plugin.id) && (
                  <span className="text-proton-purple text-sm">Added</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
