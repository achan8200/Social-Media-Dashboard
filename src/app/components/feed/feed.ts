import { Component, OnInit, AfterViewInit, ElementRef, QueryList, ViewChildren, Inject, PLATFORM_ID, ChangeDetectorRef } from '@angular/core';
import { AsyncPipe, CommonModule, isPlatformBrowser } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { map, Observable } from 'rxjs';
import { PostCard } from '../post-card/post-card';
import { Post } from '../../models/post.model';
import { PostsService } from '../../services/posts.service';
import { CreatePostModal } from '../create-post-modal/create-post-modal';
import { PostModal } from '../post-modal/post-modal';
import { ConfirmModal } from "../confirm-modal/confirm-modal";
import { EditPostModal } from "../edit-post-modal/edit-post-modal";

@Component({
  selector: 'app-feed',
  standalone: true,
  imports: [AsyncPipe, CommonModule, FormsModule, PostCard, CreatePostModal, PostModal, ConfirmModal, EditPostModal],
  templateUrl: './feed.html',
  styleUrls: ['./feed.css']
})
export class Feed implements OnInit, AfterViewInit {
  posts$: Observable<Post[]>;
  dashboardState$: Observable<{ count: number; fading: boolean }>;

  showCreateModal = false;
  feedPaused = false;
  selectedPost: Post | null = null;
  selectedPostToDelete: Post | null = null;

  editingPost: Post | null = null;

  @ViewChildren('postRef') postElements!: QueryList<ElementRef>;
  @ViewChildren(PostCard) postCards!: QueryList<PostCard>;

  private observer!: IntersectionObserver;
  private isBrowser: boolean;

  constructor(
    private postsService: PostsService,
    private cdr: ChangeDetectorRef,
    @Inject(PLATFORM_ID) platformId: Object
  ) {
    this.isBrowser = isPlatformBrowser(platformId);
    this.dashboardState$ = this.postsService.dashboardState$;

    // Subscribe directly to posts and patch only dynamic properties
    this.posts$ = this.postsService.getPosts().pipe(
      map(posts => posts.map(post => {
        // Only add dynamic properties if they don't exist yet
        if (post.isNew === undefined) {
          post.isNew = !this.postsService.hasSeen(post.id);
          post.fadingOut = false;
        }
        return post;
      }))
    );
  }

  ngOnInit() {}

  ngAfterViewInit(): void {
    if (!this.isBrowser) return;

    // IntersectionObserver callback
    const callback: IntersectionObserverCallback = entries => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;

        const postEl = entry.target as HTMLElement;
        const postId = postEl.dataset['id'];
        if (!postId) return;

        // Mark post as seen in service (updates localStorage)
        this.postsService.markPostAsSeen(postId);

        // Fade out "New" badge on the corresponding PostCard
        setTimeout(() => {
          const card = this.postCards.find(c => c.post?.id === postId);
          if (card) card.fadeOut();
          this.cdr.markForCheck();
        }, 1000); // 1 second delay

        this.cdr.markForCheck();
        this.observer.unobserve(postEl);
      });
    };

    // Initialize observer
    this.observer = new IntersectionObserver(callback, { threshold: 0.5 });

    // Observe all initial posts
    this.observePosts();

    // Observe future posts added dynamically
    this.postElements.changes.subscribe(() => this.observePosts());
  }

  private observePosts() {
    if (!this.postElements || !this.observer) return;

    this.postElements.forEach(postEl => {
      const nativeEl = postEl.nativeElement as HTMLElement;

      // Only observe if not already observed
      if (!(nativeEl as any).__observed) {
        this.observer.observe(nativeEl);
        (nativeEl as any).__observed = true;
      }
    });
  }

  openCreateModal() {
    this.showCreateModal = true;
  }

  closeCreateModal() {
    this.showCreateModal = false;
  }

  openPostModal(post: Post) {
    this.selectedPost = post;
    this.feedPaused = true;

    // Pause all videos immediately
    this.postCards.forEach(card => card.pauseAutoplay());
  }

  closePostModal() {
    // Store the post id before closing
    const closedPostId = this.selectedPost?.id;
    this.selectedPost = null;
    this.feedPaused = false;

    if (!closedPostId) return;

    // Resume autoplay for all PostCards
    this.postCards.forEach(card => card.resumeAutoplay());

    // Optional: Find the PostCard for this post and resume autoplay
    // const card = this.postCards.find(c => c.post?.id === closedPostId);
    // card?.resumeAutoplay();
  }

  async likePost(id: string) {
    const liked = await this.postsService.toggleLike(id);

    this.postsService.updatePostLocal(id, post => {
      post.likesCount = (post.likesCount ?? 0) + (liked ? 1 : -1);
    });
  }

  handlePostSeen(postId: string) {
    this.postsService.markPostAsSeen(postId);
  }

  onDeletePost(post: Post) {
    this.selectedPostToDelete = post;
  }

  confirmDelete() {
    if (!this.selectedPostToDelete) return;

    this.postsService.deletePost(this.selectedPostToDelete)
      .catch(err => console.error(err));

    this.selectedPostToDelete = null;
  }

  cancelDelete() {
    this.selectedPostToDelete = null;
  }

  // --- Edit Post Handlers ---
  onEditPost(post: Post) {
    this.editingPost = post;
  }

  cancelEdit() {
    this.editingPost = null;
  }

  async updatePost(newCaption: string) {
    if (!this.editingPost) return;

    const postId = this.editingPost.id;

    // Optimistic local update
    this.postsService.updatePostCaptionLocal(postId, newCaption);

    // Close modal
    this.editingPost = null;

    // Firestore update
    try {
      await this.postsService.updatePostCaption(postId, newCaption);
    } catch (err) {
      console.error('Failed to update post:', err);

      // Optionally reload posts or rollback
      // this.posts$ = this.postsService.getPosts();
    }
  }

  trackByPostId(index: number, post: Post) {
    return post.id;
  }
}
