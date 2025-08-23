import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable  } from 'rxjs';
import { map, shareReplay } from 'rxjs/operators';
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

  private newPostCountSubject = new BehaviorSubject<number>(0);
  newPostCount$ = this.newPostCountSubject.asObservable();

  private dashboardFadingSubject = new BehaviorSubject<boolean>(false);
  dashboardFading$ = this.dashboardFadingSubject.asObservable();

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

  addPost(author: string, content: string) {
    const newPost = {
      id: Date.now(), // unique ID
      author,
      content,
      likes: 0,
      comments: 0,
      shares: 0,
      likedByUser: false,
      isNew: true // marked as new
    };
    this.posts = [newPost, ...this.posts]; // prepend new post
    this.postsSubject.next(this.posts);
    this.updateNewPostCount();
  }

  // Mark a post as seen with fade-out support
  markPostAsSeen(id: number) {
    const post = this.posts.find(p => p.id === id);
    if (post && post.isNew) {
      // trigger fade-out
      (post as any).fadingOut = true;
      this.postsSubject.next([...this.posts]);

      // after transition (700ms in your HTML), remove the badge
      setTimeout(() => {
        post.isNew = false;
        (post as any).fadingOut = false;
        this.postsSubject.next([...this.posts]);
        this.updateNewPostCount();
      }, 700); // match CSS duration
    }
  }

  private updateNewPostCount() {
  const count = this.posts.filter(p => p.isNew).length;

  if (count === 0 && this.newPostCountSubject.value > 0) {
    // trigger fade-out
    this.dashboardFadingSubject.next(true);
    this.newPostCountSubject.next(this.newPostCountSubject.value); // keep last visible count

    setTimeout(() => {
      this.dashboardFadingSubject.next(false);
      this.newPostCountSubject.next(0);
    }, 700); // match CSS duration
  } else {
    this.newPostCountSubject.next(count);
  }
}

  updatePosts(posts: Post[]) {
    this.postsSubject.next([...posts]); // spread to create new reference
  }
}