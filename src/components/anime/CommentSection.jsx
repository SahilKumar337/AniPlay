import { useState, useEffect, memo, useCallback } from 'react';
import { MessageSquare, Send, ThumbsUp, User } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { fetchCloudComments, postCloudComment, toggleCommentLike } from '../../api/supabase';
import { useApp } from '../../context/AppContext';

function CommentSection({ animeId, epNum = 1 }) {
  const { user } = useApp();
  const [comments, setComments] = useState([]);
  const [loading, setLoading] = useState(false);
  const [text, setText] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const loadComments = useCallback(async () => {
    if (!animeId) return;
    try {
      setLoading(true);
      const data = await fetchCloudComments(animeId, epNum);
      setComments(data || []);
    } catch (err) {
      console.error('[Comments] Failed to load:', err);
    } finally {
      setLoading(false);
    }
  }, [animeId, epNum]);

  useEffect(() => {
    loadComments();
  }, [loadComments]);

  const handlePost = async (e) => {
    e.preventDefault();
    if (!text.trim() || submitting || !user) return;

    try {
      setSubmitting(true);
      const newComment = await postCloudComment(animeId, epNum, text.trim(), user);
      if (newComment) {
        setComments(prev => [newComment, ...prev]);
        setText('');
      }
    } catch (err) {
      console.error('[Comments] Post failed:', err);
    } finally {
      setSubmitting(false);
    }
  };

  const handleLike = async (commentId) => {
    if (!user) return;
    // Optimistic like toggle
    setComments(prev =>
      prev.map(c => {
        if (c.id === commentId) {
          const isLiked = c.isLikedByMe;
          return {
            ...c,
            isLikedByMe: !isLiked,
            likes_count: (c.likes_count || 0) + (isLiked ? -1 : 1),
          };
        }
        return c;
      })
    );
    try {
      await toggleCommentLike(commentId, user.id);
    } catch (err) {
      console.error('[Comments] Like failed:', err);
      loadComments(); // rollback on error
    }
  };

  return (
    <div style={{ marginTop: 24, padding: '0 4px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <MessageSquare size={18} color="var(--accent)" />
          <h3 style={{ fontSize: 16, fontWeight: 800, color: 'var(--text-primary)' }}>
            Discussion ({comments.length})
          </h3>
        </div>
      </div>

      {/* Input box */}
      {user ? (
        <form
          onSubmit={handlePost}
          style={{
            display: 'flex',
            gap: 8,
            marginBottom: 20,
            background: 'rgba(255, 255, 255, 0.04)',
            borderRadius: 14,
            padding: '6px 6px 6px 14px',
            border: '1px solid var(--border)',
          }}
        >
          <input
            type="text"
            value={text}
            onChange={e => setText(e.target.value)}
            placeholder="Share your thoughts on this episode..."
            style={{
              flex: 1,
              background: 'transparent',
              border: 'none',
              color: 'var(--text-primary)',
              fontSize: 13,
            }}
          />
          <motion.button
            type="submit"
            disabled={!text.trim() || submitting}
            whileTap={{ scale: 0.92 }}
            transition={{ type: 'spring', stiffness: 500, damping: 28 }}
            style={{
              width: 36,
              height: 36,
              borderRadius: 10,
              background: text.trim() ? 'var(--accent)' : 'rgba(255, 255, 255, 0.06)',
              color: '#fff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: text.trim() ? 'pointer' : 'default',
            }}
          >
            <Send size={15} />
          </motion.button>
        </form>
      ) : (
        <div
          style={{
            padding: '12px 16px',
            borderRadius: 12,
            background: 'rgba(255, 255, 255, 0.03)',
            border: '1px solid var(--border)',
            fontSize: 12,
            color: 'var(--text-tertiary)',
            marginBottom: 20,
            textAlign: 'center',
          }}
        >
          Sign in to join the conversation and post comments.
        </div>
      )}

      {/* Comment List */}
      {loading && !comments.length ? (
        <div style={{ padding: '24px 0', textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}>
          Loading comments...
        </div>
      ) : !comments.length ? (
        <div style={{ padding: '24px 0', textAlign: 'center', color: 'var(--text-tertiary)', fontSize: 13 }}>
          No comments yet. Be the first to start the discussion!
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <AnimatePresence>
            {comments.map((comment) => (
              <motion.div
                key={comment.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95 }}
                transition={{ duration: 0.22 }}
                style={{
                  padding: '12px 14px',
                  borderRadius: 14,
                  background: 'rgba(255, 255, 255, 0.03)',
                  border: '1px solid var(--border)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div
                      style={{
                        width: 26,
                        height: 26,
                        borderRadius: 13,
                        background: 'rgba(108, 99, 255, 0.2)',
                        color: 'var(--accent)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: 11,
                        fontWeight: 700,
                      }}
                    >
                      <User size={14} />
                    </div>
                    <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)' }}>
                      {comment.author_name || comment.author_email || 'Anime Fan'}
                    </span>
                  </div>
                  <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                    {comment.created_at ? new Date(comment.created_at).toLocaleDateString() : ''}
                  </span>
                </div>

                <p style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.4, margin: '4px 0 8px' }}>
                  {comment.content}
                </p>

                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <motion.button
                    onClick={() => handleLike(comment.id)}
                    whileTap={{ scale: 0.88 }}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 4,
                      fontSize: 11,
                      color: comment.isLikedByMe ? 'var(--accent)' : 'var(--text-tertiary)',
                      background: 'none',
                      padding: '2px 6px',
                      borderRadius: 6,
                    }}
                  >
                    <ThumbsUp size={12} fill={comment.isLikedByMe ? 'var(--accent)' : 'none'} />
                    {comment.likes_count || 0}
                  </motion.button>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}

export default memo(CommentSection);
