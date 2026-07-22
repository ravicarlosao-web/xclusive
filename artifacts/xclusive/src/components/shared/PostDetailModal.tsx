import { Dialog, DialogContent } from '@/components/ui/dialog';
import { PostCard } from './PostCard';
import type { Post } from '@workspace/api-client-react';

interface PostDetailModalProps {
  post: Post | null;
  onClose: () => void;
}

export function PostDetailModal({ post, onClose }: PostDetailModalProps) {
  return (
    <Dialog open={!!post} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-[540px] w-full p-0 bg-transparent border-none shadow-none">
        {post && (
          <PostCard post={post} />
        )}
      </DialogContent>
    </Dialog>
  );
}
