import { useState, useEffect, memo, useCallback, useRef, useMemo } from 'react';
import { MessageSquare, Send, ThumbsUp, User, RefreshCw, ChevronDown, ChevronUp, Reply, X, CornerDownRight } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { fetchCloudComments, postCloudComment, toggleCommentLike } from '../../api/supabase';
import { useApp } from '../../context/AppContext';

const PAGE_SIZE = 30;

// ── localStorage-backed like state (zero egress) ─────────────────────
function getLikedComments() {
  try { return new Set(JSON.parse(localStorage.getItem('aniplay_liked_comments') || '[]')); }
  catch { return new Set(); }
}
function persistLike(commentId, liked) {
  try {
    const set = getLikedComments();
    liked ? set.add(commentId) : set.delete(commentId);
    localStorage.setItem('aniplay_liked_comments', JSON.stringify([...set]));
  } catch { /* ignore */ }
}

function timeAgo(iso) {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}

// ── Single Comment (used for both Root comments and Replies) ─────────
function CommentItem({
  comment,
  replies = [],
  onLike,
  onReplySubmit,
  user,
  isNested = false,
}) {
  const isLiked = getLikedComments().has(comment.id);
  const [liked, setLiked] = useState(isLiked);
  const [count, setCount] = useState(comment.likes_count || 0);
  const [animating, setAnimating] = useState(false);

  const [showReplyInput, setShowReplyInput] = useState(false);
  const [replyText, setReplyText] = useState('');
  const [replySubmitting, setReplySubmitting] = useState(false);
  const [repliesExpanded, setRepliesExpanded] = useState(true);
  const replyInputRef = useRef(null);

  const handleLike = () => {
    const next = !liked;
    setLiked(next);
    setCount(c => c + (next ? 1 : -1));
    persistLike(comment.id, next);
    setAnimating(true);
    setTimeout(() => setAnimating(false), 350);
    onLike(comment.id, next);
  };

  const handleOpenReply = () => {
    if (!user) return;
    setShowReplyInput(prev => !prev);
    if (!showReplyInput) {
      setTimeout(() => replyInputRef.current?.focus(), 50);
    }
  };

  const handleSendReply = async (e) => {
    e.preventDefault();
    if (!replyText.trim() || replySubmitting) return;
    setReplySubmitting(true);
    try {
      await onReplySubmit(comment.id, replyText.trim());
      setReplyText('');
      setShowReplyInput(false);
      setRepliesExpanded(true);
    } catch (err) {
      console.error('Failed to submit reply:', err);
    } finally {
      setReplySubmitting(false);
    }
  };

  const hasReplies = replies && replies.length > 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={{ duration: 0.2 }}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
      }}
    >
      {/* Comment Bubble */}
      <div
        style={{
          padding: isNested ? '10px 12px' : '12px 14px',
          borderRadius: 14,
          background: isNested ? 'rgba(255,255,255,0.02)' : 'rgba(255,255,255,0.035)',
          border: isNested ? '1px solid rgba(255,255,255,0.05)' : '1px solid var(--border)',
        }}
      >
        {/* Header: User & Time */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{
              width: isNested ? 24 : 28,
              height: isNested ? 24 : 28,
              borderRadius: '50%',
              background: isNested
                ? 'rgba(167,139,250,0.18)'
                : 'linear-gradient(135deg, rgba(108,99,255,0.3), rgba(167,139,250,0.2))',
              color: 'var(--accent)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              flexShrink: 0,
            }}>
              <User size={isNested ? 11 : 13} />
            </div>
            <span style={{
              fontSize: isNested ? 11 : 12,
              fontWeight: 700,
              color: 'var(--text-primary)',
            }}>
              {comment.username || 'Anime Fan'}
            </span>
          </div>
          <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{timeAgo(comment.created_at)}</span>
        </div>

        {/* Content */}
        <p style={{
          fontSize: isNested ? 12 : 13,
          color: 'var(--text-secondary)',
          lineHeight: 1.5,
          margin: '4px 0 8px',
          wordBreak: 'break-word',
        }}>
          {comment.content}
        </p>

        {/* Actions Bar: Like + Reply */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
          {/* Like Button */}
          <motion.button
            onClick={handleLike}
            whileTap={{ scale: 0.82 }}
            transition={{ type: 'spring', stiffness: 500, damping: 22 }}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 4,
              fontSize: 11, fontWeight: 600,
              color: liked ? 'var(--accent)' : 'var(--text-tertiary)',
              background: liked ? 'rgba(99,102,241,0.1)' : 'transparent',
              border: liked ? '1px solid rgba(99,102,241,0.2)' : '1px solid transparent',
              padding: '3px 8px', borderRadius: 20, cursor: 'pointer',
              transition: 'all 0.2s ease',
            }}
          >
            <motion.span
              animate={animating ? { scale: [1, 1.4, 1] } : {}}
              transition={{ duration: 0.3 }}
              style={{ display: 'flex' }}
            >
              <ThumbsUp size={11} fill={liked ? 'var(--accent)' : 'none'} />
            </motion.span>
            {count > 0 ? count : ''}
          </motion.button>

          {/* Reply Button (available if user is logged in or opens reply box) */}
          {user && (
            <motion.button
              onClick={handleOpenReply}
              whileTap={{ scale: 0.88 }}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 4,
                fontSize: 11, fontWeight: 600,
                color: showReplyInput ? 'var(--accent)' : 'var(--text-tertiary)',
                background: showReplyInput ? 'rgba(99,102,241,0.08)' : 'transparent',
                border: 'none',
                padding: '3px 8px', borderRadius: 20, cursor: 'pointer',
              }}
            >
              <Reply size={11} />
              Reply
            </motion.button>
          )}

          {/* Expand/Collapse replies toggle if has nested replies */}
          {hasReplies && (
            <button
              onClick={() => setRepliesExpanded(prev => !prev)}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 4,
                fontSize: 11, fontWeight: 600,
                color: 'var(--accent)',
                background: 'transparent',
                border: 'none',
                padding: '3px 6px',
                cursor: 'pointer',
                marginLeft: 'auto',
              }}
            >
              {repliesExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
              {replies.length} {replies.length === 1 ? 'reply' : 'replies'}
            </button>
          )}
        </div>
      </div>

      {/* Inline Reply Input Box */}
      <AnimatePresence>
        {showReplyInput && (
          <motion.form
            initial={{ opacity: 0, height: 0, y: -4 }}
            animate={{ opacity: 1, height: 'auto', y: 0 }}
            exit={{ opacity: 0, height: 0, y: -4 }}
            transition={{ duration: 0.2 }}
            onSubmit={handleSendReply}
            style={{
              marginLeft: isNested ? 16 : 24,
              paddingLeft: 10,
              borderLeft: '2px solid rgba(99,102,241,0.3)',
              display: 'flex', gap: 6, alignItems: 'center',
              overflow: 'hidden',
            }}
          >
            <div style={{
              display: 'flex', flex: 1, alignItems: 'center', gap: 6,
              background: 'rgba(255,255,255,0.05)',
              borderRadius: 12, padding: '4px 6px 4px 12px',
              border: '1px solid rgba(99,102,241,0.25)',
            }}>
              <input
                ref={replyInputRef}
                type="text"
                value={replyText}
                onChange={e => setReplyText(e.target.value)}
                placeholder={`Reply to ${comment.username || 'user'}…`}
                disabled={replySubmitting}
                maxLength={400}
                style={{
                  flex: 1, background: 'transparent', border: 'none',
                  color: 'var(--text-primary)', fontSize: 12, outline: 'none',
                }}
              />
              <button
                type="button"
                onClick={() => setShowReplyInput(false)}
                style={{
                  background: 'none', border: 'none', color: 'var(--text-muted)',
                  padding: 4, cursor: 'pointer', display: 'flex',
                }}
              >
                <X size={12} />
              </button>
              <motion.button
                type="submit"
                disabled={!replyText.trim() || replySubmitting}
                whileTap={{ scale: 0.88 }}
                style={{
                  width: 28, height: 28, borderRadius: 8, flexShrink: 0,
                  background: replyText.trim() && !replySubmitting
                    ? 'linear-gradient(135deg, #6366f1, #a78bfa)'
                    : 'rgba(255,255,255,0.06)',
                  color: '#fff',
                  border: 'none',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  cursor: replyText.trim() ? 'pointer' : 'default',
                }}
              >
                {replySubmitting
                  ? <span style={{ width: 10, height: 10, border: '2px solid #fff', borderTopColor: 'transparent', borderRadius: '50%', display: 'block', animation: 'spin 0.7s linear infinite' }} />
                  : <Send size={11} />
                }
              </motion.button>
            </div>
          </motion.form>
        )}
      </AnimatePresence>

      {/* Render Nested Replies */}
      <AnimatePresence>
        {hasReplies && repliesExpanded && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
            style={{
              marginLeft: isNested ? 14 : 20,
              paddingLeft: 12,
              borderLeft: '2px solid rgba(99,102,241,0.25)',
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
              marginTop: 4,
              overflow: 'hidden',
            }}
          >
            {replies.map(reply => (
              <CommentItem
                key={reply.id}
                comment={reply}
                replies={[]}
                onLike={onLike}
                onReplySubmit={onReplySubmit}
                user={user}
                isNested={true}
              />
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function CommentSection({ animeId }) {
  const { user } = useApp();
  const [comments, setComments] = useState([]);
  const [totalCount, setTotalCount] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [text, setText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const inputRef = useRef(null);

  const loadComments = useCallback(async (reset = false) => {
    if (!animeId) return;
    const currentOffset = reset ? 0 : offset;
    try {
      reset ? setLoading(true) : setLoadingMore(true);
      const { data, count } = await fetchCloudComments(animeId, currentOffset);
      setComments(prev => reset ? (data || []) : [...prev, ...(data || [])]);
      setTotalCount(count || 0);
      if (!reset) setOffset(currentOffset + PAGE_SIZE);
    } catch (err) {
      console.error('[Comments] Load failed:', err);
      setError('Failed to load comments. Tap to retry.');
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [animeId, offset]);

  useEffect(() => {
    setComments([]);
    setOffset(0);
    setTotalCount(0);
    setError(null);
    loadComments(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [animeId]);

  // Organize comments into a tree: root comments and replies map
  const { roots, replyMap } = useMemo(() => {
    const replyMap = new Map();
    const roots = [];
    const idSet = new Set(comments.map(c => c.id));

    // First pass: identify who has parent_id that exists in comments
    comments.forEach(c => {
      if (c.parent_id && idSet.has(c.parent_id)) {
        if (!replyMap.has(c.parent_id)) replyMap.set(c.parent_id, []);
        replyMap.get(c.parent_id).push(c);
      } else {
        roots.push(c);
      }
    });

    // Sort replies chronologically so conversation reads naturally top-to-bottom
    replyMap.forEach(list => list.sort((a, b) => new Date(a.created_at) - new Date(b.created_at)));
    return { roots, replyMap };
  }, [comments]);

  const getUsername = useCallback(() => {
    return user?.user_metadata?.nickname
      || user?.user_metadata?.name
      || (user?.email ? user.email.split('@')[0] : null)
      || 'Anime Fan';
  }, [user]);

  const handlePost = async (e) => {
    e.preventDefault();
    if (!text.trim() || submitting) return;

    const username = getUsername();

    try {
      setSubmitting(true);
      setError(null);
      await postCloudComment(animeId, username, text.trim(), null, 0);
      setText('');
      // Reload from top to see new comment
      setOffset(0);
      await loadComments(true);
      inputRef.current?.blur();
    } catch (err) {
      console.error('[Comments] Post failed:', err);
      setError('Failed to post comment. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleReplySubmit = async (parentId, replyContent) => {
    const username = getUsername();
    setError(null);
    try {
      await postCloudComment(animeId, username, replyContent, parentId, 0);
      // Reload comments so tree is refreshed
      setOffset(0);
      await loadComments(true);
    } catch (err) {
      console.error('[Comments] Reply failed:', err);
      setError('Failed to post reply. Please try again.');
      throw err;
    }
  };

  const handleLike = async (commentId, isLiking) => {
    try {
      await toggleCommentLike(commentId, isLiking);
    } catch (err) {
      console.error('[Comments] Like failed:', err);
    }
  };

  const hasMore = comments.length < totalCount;

  return (
    <div style={{ marginTop: 24, padding: '0 4px' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <MessageSquare size={17} color="var(--accent)" />
          <h3 style={{ fontSize: 15, fontWeight: 800, color: 'var(--text-primary)' }}>
            Discussion {totalCount > 0 ? `(${totalCount})` : ''}
          </h3>
        </div>
        <motion.button
          onClick={() => { setOffset(0); loadComments(true); }}
          whileTap={{ rotate: 180 }}
          transition={{ duration: 0.35 }}
          style={{ color: 'var(--text-muted)', background: 'none', border: 'none', padding: 4, cursor: 'pointer' }}
          title="Refresh"
        >
          <RefreshCw size={14} />
        </motion.button>
      </div>

      {/* Input Box for Root Comments */}
      <form
        onSubmit={handlePost}
        style={{
          display: 'flex', gap: 8, marginBottom: 16,
          background: 'rgba(255,255,255,0.04)',
          borderRadius: 14, padding: '6px 6px 6px 14px',
          border: '1px solid var(--border)',
        }}
      >
        <input
          ref={inputRef}
          type="text"
          value={text}
          onChange={e => setText(e.target.value)}
          placeholder={user ? 'Share your thoughts…' : 'Sign in to comment'}
          disabled={!user || submitting}
          maxLength={500}
          style={{
            flex: 1, background: 'transparent', border: 'none',
            color: 'var(--text-primary)', fontSize: 13, outline: 'none',
          }}
        />
        <motion.button
          type="submit"
          disabled={!text.trim() || submitting || !user}
          whileTap={{ scale: 0.88 }}
          transition={{ type: 'spring', stiffness: 500, damping: 28 }}
          style={{
            width: 36, height: 36, borderRadius: 10, flexShrink: 0,
            background: (text.trim() && user && !submitting)
              ? 'linear-gradient(135deg, #6366f1, #a78bfa)'
              : 'rgba(255,255,255,0.06)',
            color: '#fff',
            border: 'none',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: (text.trim() && user) ? 'pointer' : 'default',
            transition: 'background 0.2s ease',
          }}
        >
          {submitting
            ? <span style={{ width: 12, height: 12, border: '2px solid #fff', borderTopColor: 'transparent', borderRadius: '50%', display: 'block', animation: 'spin 0.7s linear infinite' }} />
            : <Send size={14} />
          }
        </motion.button>
      </form>

      {/* Error banner */}
      <AnimatePresence>
        {error && (
          <motion.div
            initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            onClick={() => { setError(null); loadComments(true); }}
            style={{
              fontSize: 12, color: '#f87171', background: 'rgba(248,113,113,0.08)',
              border: '1px solid rgba(248,113,113,0.2)', borderRadius: 10,
              padding: '8px 12px', marginBottom: 12, cursor: 'pointer', textAlign: 'center',
            }}
          >
            {error}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Comment List */}
      {loading ? (
        <div style={{ padding: '28px 0', textAlign: 'center' }}>
          <span style={{ width: 18, height: 18, border: '2px solid var(--accent)', borderTopColor: 'transparent', borderRadius: '50%', display: 'inline-block', animation: 'spin 0.7s linear infinite' }} />
        </div>
      ) : !roots.length ? (
        <div style={{ padding: '28px 0', textAlign: 'center', color: 'var(--text-tertiary)', fontSize: 13 }}>
          No comments yet. Be the first to start the discussion!
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <AnimatePresence initial={false}>
            {roots.map(rootComment => (
              <CommentItem
                key={rootComment.id}
                comment={rootComment}
                replies={replyMap.get(rootComment.id) || []}
                onLike={handleLike}
                onReplySubmit={handleReplySubmit}
                user={user}
                isNested={false}
              />
            ))}
          </AnimatePresence>

          {/* Load More */}
          {hasMore && (
            <motion.button
              onClick={() => loadComments(false)}
              disabled={loadingMore}
              whileTap={{ scale: 0.96 }}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                padding: '10px 0', borderRadius: 12,
                background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border)',
                color: 'var(--text-secondary)', fontSize: 12, fontWeight: 600,
                cursor: loadingMore ? 'default' : 'pointer', marginTop: 4,
              }}
            >
              {loadingMore
                ? <span style={{ width: 12, height: 12, border: '2px solid currentColor', borderTopColor: 'transparent', borderRadius: '50%', display: 'inline-block', animation: 'spin 0.7s linear infinite' }} />
                : <><ChevronDown size={14} /> Load more ({totalCount - comments.length} remaining)</>
              }
            </motion.button>
          )}
        </div>
      )}
    </div>
  );
}

export default memo(CommentSection);
