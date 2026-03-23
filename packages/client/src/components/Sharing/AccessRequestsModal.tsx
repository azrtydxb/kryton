import { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X, Check, XCircle, ChevronDown } from 'lucide-react';
import { accessRequestApi } from '../../lib/api';

interface AccessRequestsModalProps {
  onClose: () => void;
}

interface AccessRequest {
  id: string;
  requesterUserId: string;
  requesterName?: string;
  requesterEmail?: string;
  notePath: string;
  status: string;
  createdAt: string;
}

type Permission = 'read' | 'readwrite';

export function AccessRequestsModal({ onClose }: AccessRequestsModalProps) {
  const [requests, setRequests] = useState<AccessRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [approvingId, setApprovingId] = useState<string | null>(null);
  const [selectedPermission, setSelectedPermission] = useState<Permission>('read');
  const [respondingIds, setRespondingIds] = useState<Set<string>>(new Set());

  const dialogRef = useRef<HTMLDivElement>(null);

  const fetchRequests = useCallback(async () => {
    try {
      const data = await accessRequestApi.list();
      setRequests(data.filter((r: AccessRequest) => r.status === 'pending'));
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRequests();
  }, [fetchRequests]);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  const handleOverlayClick = useCallback(
    (e: React.MouseEvent) => {
      if (dialogRef.current && !dialogRef.current.contains(e.target as Node)) {
        onClose();
      }
    },
    [onClose],
  );

  const handleApprove = useCallback(
    async (id: string) => {
      setRespondingIds((prev) => new Set(prev).add(id));
      try {
        await accessRequestApi.respond(id, 'approve', selectedPermission);
        setRequests((prev) => prev.filter((r) => r.id !== id));
        setApprovingId(null);
      } catch {
        // silently fail
      } finally {
        setRespondingIds((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      }
    },
    [selectedPermission],
  );

  const handleDeny = useCallback(async (id: string) => {
    setRespondingIds((prev) => new Set(prev).add(id));
    try {
      await accessRequestApi.respond(id, 'deny');
      setRequests((prev) => prev.filter((r) => r.id !== id));
    } catch {
      // silently fail
    } finally {
      setRespondingIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  }, []);

  const formatDate = (dateStr: string) => {
    try {
      return new Date(dateStr).toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      });
    } catch {
      return dateStr;
    }
  };

  const modal = (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={handleOverlayClick}
    >
      <div
        ref={dialogRef}
        className="bg-white dark:bg-surface-900 rounded-xl shadow-2xl border dark:border-surface-700 w-full max-w-md mx-4 overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b dark:border-surface-700">
          <h2 className="text-sm font-semibold">Access Requests</h2>
          <button onClick={onClose} className="btn-ghost p-1" aria-label="Close">
            <X size={16} />
          </button>
        </div>

        <div className="px-5 py-4 space-y-2">
          {loading ? (
            <p className="text-xs text-gray-400 py-2">Loading...</p>
          ) : requests.length === 0 ? (
            <p className="text-xs text-gray-400 dark:text-gray-500 py-2">
              No pending requests
            </p>
          ) : (
            <div className="space-y-2 max-h-80 overflow-y-auto">
              {requests.map((req) => (
                <div
                  key={req.id}
                  className="rounded-lg border dark:border-surface-600 p-3 space-y-2"
                >
                  <div className="flex items-start gap-3">
                    <div className="w-8 h-8 rounded-full bg-violet-500/20 flex items-center justify-center text-violet-500 text-sm font-semibold shrink-0">
                      {(req.requesterName || req.requesterEmail || '?').charAt(0).toUpperCase()}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium truncate">
                        {req.requesterName || req.requesterEmail || req.requesterUserId}
                      </p>
                      {req.requesterName && req.requesterEmail && (
                        <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                          {req.requesterEmail}
                        </p>
                      )}
                      <p className="text-xs text-gray-500 dark:text-gray-400 truncate mt-0.5">
                        {req.notePath}
                      </p>
                      <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
                        {formatDate(req.createdAt)}
                      </p>
                    </div>
                  </div>

                  {approvingId === req.id ? (
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-gray-500 dark:text-gray-400">Permission:</span>
                      <div className="relative">
                        <select
                          value={selectedPermission}
                          onChange={(e) => setSelectedPermission(e.target.value as Permission)}
                          className="appearance-none pl-2 pr-7 py-1 text-xs rounded-md border dark:border-surface-600 bg-transparent outline-none focus:border-violet-500 cursor-pointer"
                        >
                          <option value="read">Read</option>
                          <option value="readwrite">Read-Write</option>
                        </select>
                        <ChevronDown
                          size={12}
                          className="absolute right-1.5 top-1/2 -translate-y-1/2 pointer-events-none text-gray-400"
                        />
                      </div>
                      <button
                        onClick={() => handleApprove(req.id)}
                        disabled={respondingIds.has(req.id)}
                        className="flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-md bg-green-600 text-white hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                      >
                        <Check size={12} />
                        Confirm
                      </button>
                      <button
                        onClick={() => setApprovingId(null)}
                        className="px-2 py-1 text-xs font-medium rounded-md text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => {
                          setApprovingId(req.id);
                          setSelectedPermission('read');
                        }}
                        disabled={respondingIds.has(req.id)}
                        className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-md bg-green-600 text-white hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                      >
                        <Check size={12} />
                        Approve
                      </button>
                      <button
                        onClick={() => handleDeny(req.id)}
                        disabled={respondingIds.has(req.id)}
                        className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-md bg-red-600 text-white hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                      >
                        <XCircle size={12} />
                        Deny
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}
