import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable  } from 'rxjs';
import { Post } from '../models/post.model';

@Injectable({ providedIn: 'root' })
export class PostsService {
  posts: Post[] = [
    { id: 1, author: 'Alice', content: 'Hello Angular 🚀', likes: 0, comments: 0, shares: 0 },
    { id: 2, author: 'Bob', content: 'Loving TailwindCSS 💅', likes: 0, comments: 0, shares: 0 },
    { id: 3, author: 'Charlie', content: 'Firebase will be fun 🔥', likes: 0, comments: 0, shares: 0 },
  ];

  private postsSubject = new BehaviorSubject<Post[]>(this.posts);
  posts$ = this.postsSubject.asObservable();

  private dashboardStateSubject = new BehaviorSubject<{ count: number; fading: boolean }>({ count: 0, fading: false });
  dashboardState$ = this.dashboardStateSubject.asObservable();

  /** Track posts that have already been seen */
  private seenPosts = new Set<number>();

  addPost(author: string, content: string) {
    const newPost = {
      id: Date.now(), // unique ID
      author,
      content,
      likes: 0,
      comments: 0,
      shares: 0,
      likedByUser: false,
      isNew: true, // marked as new
      fadingOut: false
    };
    this.posts = [newPost, ...this.posts]; // prepend new post
    this.postsSubject.next(this.posts);
    // Update dashboard
    this.updateDashboardState();
  }

  hasBeenSeen(id: number): boolean {
    return this.seenPosts.has(id);
  }

  // Mark a post as seen with fade
  markPostAsSeen(id: number) {
    const post = this.posts.find(p => p.id === id);
    if (post && post.isNew && !this.seenPosts.has(id)) {
      post.fadingOut = true;
      this.postsSubject.next([...this.posts]);

      setTimeout(() => {
        post.isNew = false;
        post.fadingOut = false;
        this.seenPosts.add(id); // remember this post is seen
        this.postsSubject.next([...this.posts]);
        this.updateDashboardState();
      }, 700); // match CSS transition
    }
  }

  private updateDashboardState() {
    const count = this.posts.filter(p => p.isNew).length;
    const current = this.dashboardStateSubject.value;

    if (count === 0 && current.count > 0) {
      // trigger fade-out
      this.dashboardStateSubject.next({ count: current.count, fading: true });

      setTimeout(() => {
        this.dashboardStateSubject.next({ count: 0, fading: false });
      }, 700);
    } else {
      this.dashboardStateSubject.next({ count, fading: false });
    }
  }

  updatePosts(posts: Post[]) {
    this.postsSubject.next([...posts]); // spread to create new reference
  }

  likePost(id: number) {
    this.posts = this.posts.map(post =>
      post.id === id
        ? {
            ...post,
            likes: post.likedByUser ? post.likes - 1 : post.likes + 1,
            likedByUser: !post.likedByUser,
          }
        : post
    );
    this.postsSubject.next(this.posts);
  }

  commentPost(id: number) {
    this.posts = this.posts.map(post =>
      post.id === id ? { ...post, comments: post.comments + 1 } : post
    );
    this.postsSubject.next(this.posts);
  }

  sharePost(id: number) {
    this.posts = this.posts.map(post =>
      post.id === id ? { ...post, shares: post.shares + 1 } : post
    );
    this.postsSubject.next(this.posts);
  }
}