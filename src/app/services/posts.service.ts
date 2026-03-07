import { Injectable } from '@angular/core';
import { Firestore, collection, collectionData, query, orderBy, addDoc, serverTimestamp, doc, updateDoc, increment, getDoc, setDoc, deleteDoc, docData } from '@angular/fire/firestore';
import { Storage, ref, getDownloadURL, uploadBytesResumable, deleteObject } from '@angular/fire/storage'
import { Observable, BehaviorSubject, from, combineLatest, of } from 'rxjs';
import { catchError, map, switchMap } from 'rxjs/operators';
import { Auth } from '@angular/fire/auth';
import { Post, PostMedia } from '../models/post.model';
import { Comment } from '../models/comment.model';

@Injectable({ providedIn: 'root' })
export class PostsService {

  private dashboardStateSubject = new BehaviorSubject<{ count: number; fading: boolean }>({ count: 0, fading: false });
  dashboardState$ = this.dashboardStateSubject.asObservable();

  private seenPostsKey = 'seenPosts';
  private seenPosts = new Set<string>();

  private postsSubject = new BehaviorSubject<Post[]>([]);
  posts$ = this.postsSubject.asObservable();

  private likesSubjects = new Map<string, BehaviorSubject<boolean>>();
  private commentLikesSubjects = new Map<string, BehaviorSubject<boolean>>();

  constructor(
    private firestore: Firestore,
    private auth: Auth,
    private storage: Storage
  ) {
    // Defer loading browser-only state until we're sure we're in the browser
    this.safeLoadSeenPosts();

    // Start listening to posts (Firestore queries are safe in both SSR and browser)
    this.listenToPosts();

    // Clear cached likes whenever the user logs in or out
    this.auth.onAuthStateChanged(user => {
      // Clear previous user cache
      this.likesSubjects.clear();
      this.commentLikesSubjects.clear();

      if (!user) return;

      const uid = user.uid;
      const currentPosts = this.postsSubject.value;

      if (!currentPosts.length) return;

      // Update all post likes
      currentPosts.forEach(post => {
        const subj = new BehaviorSubject<boolean>(false);
        this.likesSubjects.set(post.id, subj);

        const likeRef = doc(this.firestore, `posts/${post.id}/likes/${uid}`);
        docData(likeRef, { idField: 'id' }).pipe(
          map(docSnap => !!docSnap?.id)
        ).subscribe(val => subj.next(val));

        // Update likes for all comments of this post
        post.comments?.forEach((comment: Comment) => {
          const key = `${uid}_${post.id}_${comment.id}`;
          const commentSubj = new BehaviorSubject<boolean>(false);
          this.commentLikesSubjects.set(key, commentSubj);

          const commentLikeRef = doc(this.firestore, `posts/${post.id}/comments/${comment.id}/likes/${uid}`);
          docData(commentLikeRef, { idField: 'id' }).pipe(
            map(docSnap => !!docSnap?.id)
          ).subscribe(val => commentSubj.next(val));
        });
      });
    });
  }


  // Real-time posts stream
  getPosts(): Observable<Post[]> {
    return this.posts$;
  }

  private listenToPosts() {
    const postsRef = collection(this.firestore, 'posts');
    const q = query(postsRef, orderBy('createdAt', 'desc'));

    collectionData(q, { idField: 'id' }).pipe(
      switchMap((posts: any[]) => {
        if (!posts.length) return of([] as Post[]);

        const uids = [...new Set(posts.map(p => p.uid))];
        const userDocs$ = uids.map(uid => from(getDoc(doc(this.firestore, `users/${uid}`))));

        return combineLatest(userDocs$).pipe(
          map(userSnaps => {
            const userMap = new Map(
              userSnaps.map(snap => [snap.id, snap.exists() ? snap.data() : {}])
            );

            return posts.map(post => {
              const user = userMap.get(post.uid) || {};
              return {
                ...post,
                username: user['username'] || 'Unknown',
                displayName: user['displayName'] || 'Unknown',
                userAvatar: user['profilePicture'] || null,
                isNew: !this.seenPosts.has(post.id),
                fadingOut: false,
                pending: false
              } as Post;
            });
          })
        );
      })
    ).subscribe(posts => {
      // Preserve optimistic posts
      const pendingPosts = this.postsSubject.value.filter(p => p.pending);
      this.postsSubject.next([...pendingPosts, ...posts]);
    });
  }

  // Create post 
  async createPost(
    caption?: string,
    files?: File[],
    onProgress?: (fileIndex: number, progress: number) => void
  ) {
    const user = this.auth.currentUser;
    if (!user) throw new Error('Not authenticated');

    const uid = user.uid;

    // Create temporary optimistic post
    const tempId = `temp-${Date.now()}`;

    const tempPost: Post = {
      id: tempId,
      uid: user.uid,
      userId: 0,

      username: user.displayName || 'You',
      displayName: user.displayName || 'You',

      caption: caption ?? '',
      media: [], // initialize as empty array

      likesCount: 0,
      commentsCount: 0,

      createdAt: new Date(),
      updatedAt: new Date(),

      pending: true
    };

    // Insert immediately into local feed
    this.addPostToLocalFeed(tempPost);

    // Upload media files (if any)
    const media: PostMedia[] = [];

    try {
      if (files?.length) {
        await Promise.all(files.map((file, i) => {
          return new Promise<void>((resolve, reject) => {
            if (!file.type.startsWith('image') && !file.type.startsWith('video')) {
              return reject(new Error('Only images and videos are allowed'));
            }

            const filePath = `post-media/${uid}/${Date.now()}_${file.name}`;
            const storageRef = ref(this.storage, filePath);
            
            // Upload
            const uploadTask = uploadBytesResumable(storageRef, file);

            uploadTask.on('state_changed',
              snapshot => {
                const progress = Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100);
                if (onProgress) onProgress(i, progress);
              },
              error => reject(error),
              async () => {
                const downloadUrl = await getDownloadURL(storageRef);
                media.push({
                  url: downloadUrl,
                  path: filePath,
                  type: file.type.startsWith('video') ? 'video' : 'image',
                  ...(file.type.startsWith('video') && { thumbnail: 'assets/video-placeholder.png' })
                });
                if (onProgress) onProgress(i, 100);
                resolve();
              }
            );
          });
        }));
      }

      // Create Firestore document
      const docRef = await addDoc(collection(this.firestore, 'posts'), {
        uid,
        caption: caption || '',
        media: media,
        likesCount: 0,
        commentsCount: 0,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });

      // Fetch latest user info
      const userSnap = await getDoc(doc(this.firestore, `users/${uid}`));
      const userData = userSnap.exists() ? userSnap.data() : {};

      // Update temp post with latest user info and mark as complete
      const updated = this.postsSubject.value.map(p =>
        p.id === tempId
          ? {
              ...p,
              username: userData?.['username'] || p.username,
              displayName: userData?.['displayName'] || p.displayName,
              userAvatar: userData?.['profilePicture'] || p.userAvatar,
              pending: false,
              media: media
            }
          : p
      );
      this.postsSubject.next(updated);
    } catch (error) {
      // If anything fails, remove optimistic post
      this.removeTempPost(tempId);
      throw error;
    }
  }

  // Insert post into local feed immediately
  private addPostToLocalFeed(post: Post) {
    const current = this.postsSubject.value;
    this.postsSubject.next([post, ...current]);
  }

  // Remove temporary post
  private removeTempPost(tempId: string) {
    const updated = this.postsSubject.value.filter(post => post.id !== tempId);
    this.postsSubject.next(updated);
  }

  // Returns an Observable of like state for a specific post
  getPostLike(postId: string): Observable<boolean> {
    // Ensure a BehaviorSubject exists
    if (!this.likesSubjects.has(postId)) {
      const subj = new BehaviorSubject<boolean>(false);
      this.likesSubjects.set(postId, subj);

      // If a user is logged in, load initial state
      const uid = this.auth.currentUser?.uid;
      if (uid) {
        const likeRef = doc(this.firestore, `posts/${postId}/likes/${uid}`);
        docData(likeRef, { idField: 'id' }).pipe(
          map(docSnap => !!docSnap?.id)
        ).subscribe(val => subj.next(val));
      }
    }

    return this.likesSubjects.get(postId)!.asObservable();
  }

  // Returns an Observable of the likes count for a specific post
  getPostLikesCount(postId: string): Observable<number> {
    return this.posts$.pipe(
      map(posts => {
        const post = posts.find(p => p.id === postId);
        return post?.likesCount ?? 0;
      })
    );
  }

  // Toggle like locally
  async toggleLikeOptimistic(postId: string): Promise<void> {
    const uid = this.auth.currentUser?.uid;
    if (!uid) return;

    // ensure BehaviorSubject exists
    if (!this.likesSubjects.has(postId)) {
      this.getPostLike(postId).subscribe(); 
    }
    const subj = this.likesSubjects.get(postId)!;

    // Optimistic toggle
    const newValue = !subj.value;
    subj.next(newValue);

    try {
      // Persist to Firestore
      await this.toggleLike(postId);
    } catch (err) {
      console.error('Failed to toggle like in Firestore:', err);
      // rollback if failed
      subj.next(!newValue);
    }

    // Update likesCount in posts$ locally
    this.updatePostLocal(postId, post => {
      if (!post.likesCount) post.likesCount = 0;
      post.likesCount += newValue ? 1 : -1;
    });
  }

  // Like post, only touch the likes subcollection
  async toggleLike(postId: string) {
    const uid = this.auth.currentUser?.uid;
    if (!uid) return false;

    const likeRef = doc(this.firestore, `posts/${postId}/likes/${uid}`);
    const snap = await getDoc(likeRef);

    if (snap.exists()) {
      // Unlike: delete the like doc
      await deleteDoc(likeRef);
      return false;
    } else {
      // Like: create the like doc
      await setDoc(likeRef, { createdAt: serverTimestamp() });
      return true;
    }
  }

  // Check if user liked the post
  getUserLike(postId: string) {
    const uid = this.auth.currentUser?.uid;
    if (!uid) return of(false);

    const likeRef = doc(this.firestore, `posts/${postId}/likes/${uid}`);
    return docData(likeRef, { idField: 'id' }).pipe(
      map(docSnap => !!docSnap?.id),
      catchError(() => of(false))
    );
  }

  // Fetch comments
  getComments(postId: string): Observable<Comment[]> {
    const commentsRef = collection(this.firestore, `posts/${postId}/comments`);
    const q = query(commentsRef, orderBy('createdAt', 'asc'));

    return collectionData(q, { idField: 'id' }).pipe(
      switchMap((comments: any[]) => {
        if (!comments.length) return of([]);

        const uids = [...new Set(comments.map(c => c.uid))];
        const userDocs$ = uids.map(uid =>
          from(getDoc(doc(this.firestore, `users/${uid}`)))
        );

        return combineLatest(userDocs$).pipe(
          map(userSnaps => {
            const userMap = new Map(
              userSnaps.map(snap => [
                snap.id,
                snap.exists() ? snap.data() : {}
              ])
            );

            return comments.map(comment => {
              const user = userMap.get(comment.uid) || {};

              return {
                ...comment,
                likesCount: comment.likesCount || 0,
                username: user['username'] || 'Unknown',
                displayName: user['displayName'] || 'Unknown',
                userAvatar: user['profilePicture'] || null
              } as Comment;
            });
          })
        );
      })
    );
  }

  // Create post comment
  async createComment(postId: string, text: string) {
    const user = this.auth.currentUser;
    if (!user) throw new Error('Not authenticated');

    const commentsRef = collection(this.firestore, `posts/${postId}/comments`);

    await addDoc(commentsRef, {
      uid: user.uid,
      text: text,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });

    // update comment counter
    await updateDoc(doc(this.firestore, `posts/${postId}`), {
      commentsCount: increment(1),
      updatedAt: serverTimestamp()
    });
  }

  // Update post comment
  async updateComment(postId: string, commentId: string, text: string) {
    const user = this.auth.currentUser;
    if (!user) throw new Error('Not authenticated');

    const ref = doc(this.firestore, `posts/${postId}/comments/${commentId}`);

    await updateDoc(ref, {
      text,
      updatedAt: serverTimestamp()
    });
  }

  // Delete post comment
  async deleteComment(postId: string, commentId: string) {
    const ref = doc(this.firestore, `posts/${postId}/comments/${commentId}`);

    await deleteDoc(ref);

    await updateDoc(doc(this.firestore, `posts/${postId}`), {
      commentsCount: increment(-1),
      updatedAt: serverTimestamp()
    });
  }

  // Observable for comment like state
  getCommentLike(postId: string, commentId: string): Observable<boolean> {
    const uid = this.auth.currentUser?.uid;
    if (!uid) return of(false);

    const key = `${uid}_${postId}_${commentId}`;
    if (!this.commentLikesSubjects.has(key)) {
      const subj = new BehaviorSubject<boolean>(false);
      this.commentLikesSubjects.set(key, subj);

      const likeRef = doc(this.firestore, `posts/${postId}/comments/${commentId}/likes/${uid}`);
      docData(likeRef, { idField: 'id' }).pipe(
        map(docSnap => !!docSnap?.id)
      ).subscribe(val => subj.next(val));
    }

    return this.commentLikesSubjects.get(key)!.asObservable();
  }

  // Toggle like/unlike comment
  async toggleCommentLike(postId: string, commentId: string) {
    const uid = this.auth.currentUser?.uid;
    if (!uid) return;

    const likeRef = doc(this.firestore, `posts/${postId}/comments/${commentId}/likes/${uid}`);
    const commentRef = doc(this.firestore, `posts/${postId}/comments/${commentId}`);

    const snap = await getDoc(likeRef);
    const key = `${postId}_${commentId}`;
    const subj = this.commentLikesSubjects.get(key) ?? new BehaviorSubject<boolean>(false);
    this.commentLikesSubjects.set(key, subj);

    if (snap.exists()) {
      // Unlike
      await deleteDoc(likeRef);
      await updateDoc(commentRef, { likesCount: increment(-1) });
      subj.next(false);
    } else {
      // Like
      await setDoc(likeRef, { createdAt: serverTimestamp() });
      await updateDoc(commentRef, { likesCount: increment(1) });
      subj.next(true);
    }
  }

  // Observable for likes count of a comment
  getCommentLikesCount(postId: string, commentId: string): Observable<number> {
    const commentsRef = doc(this.firestore, `posts/${postId}/comments/${commentId}`);
    return docData(commentsRef).pipe(
      map((comment: any) => comment?.likesCount || 0)
    );
  }

  // Load post on feed locally
  updatePostLocal(postId: string, updateFn: (post: Post) => void) {
    const posts = this.postsSubject.getValue(); // postsSubject exists here
    const post = posts.find(p => p.id === postId);
    if (post) updateFn(post);
    this.postsSubject.next([...posts]);
  }

  // Update only the caption of a post
  async updatePostCaption(postId: string, newCaption: string) {
    const user = this.auth.currentUser;
    if (!user) throw new Error('Not authenticated');

    // Get the current post
    const currentPost = this.postsSubject.value.find(p => p.id === postId);
    if (!currentPost) throw new Error('Post not found');

    if (currentPost.uid !== user.uid) {
      throw new Error('Unauthorized edit attempt');
    }

    const postRef = doc(this.firestore, `posts/${postId}`);

    // Optimistically update local post
    const updatedLocal = this.postsSubject.value.map(p =>
      p.id === postId ? { ...p, caption: newCaption, updatedAt: new Date() } : p
    );
    this.postsSubject.next(updatedLocal);

    // Update Firestore
    await updateDoc(postRef, {
      caption: newCaption,
      updatedAt: serverTimestamp()
    });
  }

  // Optimistically update a post caption locally
  updatePostCaptionLocal(postId: string, newCaption: string) {
    const currentPosts = this.postsSubject.value;
    this.postsSubject.next(
      currentPosts.map(p =>
        p.id === postId ? { ...p, caption: newCaption } : p
      )
    );
  }

  // Delete post
  async deletePost(post: Post) {
    const user = this.auth.currentUser;
    if (!user) throw new Error('Not authenticated');

    if (user.uid !== post.uid) {
      throw new Error('Unauthorized delete attempt');
    }

    // Delete media from Firebase Storage
    if (post.media?.length) {
      for (const media of post.media) {
        try {
          const storageRef = ref(this.storage, media.path);
          await deleteObject(storageRef);
        } catch (err) {
          console.warn('Failed to delete media:', err);
        }
      }
    }

    // Delete Firestore document
    const postRef = doc(this.firestore, `posts/${post.id}`);
    await deleteDoc(postRef);

    // Remove locally for instant UI update
    const updated = this.postsSubject.value.filter(p => p.id !== post.id);
    this.postsSubject.next(updated);
  }

  // Load already seen posts
  private safeLoadSeenPosts() {
    if (typeof window === 'undefined' || !window.localStorage) return;

    const saved = localStorage.getItem(this.seenPostsKey);
    if (!saved) return;

    try {
      const ids = JSON.parse(saved) as string[];
      this.seenPosts = new Set(ids);
    } catch {
      this.seenPosts = new Set();
    }
  }

  // Mark post as seen
  markPostAsSeen(postId: string) {
    if (this.seenPosts.has(postId)) return;

    this.seenPosts.add(postId);

    // Only write to localStorage if in browser
    if (typeof window !== 'undefined' && window.localStorage) {
      try {
        localStorage.setItem(this.seenPostsKey, JSON.stringify([...this.seenPosts]));
      } catch {
        // Silently fail if localStorage is unavailable or quota exceeded
      }
    }

    this.updateDashboardState();
  }

  private updateDashboardState() {
    const count = this.seenPosts.size;
    this.dashboardStateSubject.next({ count, fading: false });
  }

  hasSeen(postId: string): boolean {
    return this.seenPosts.has(postId);
  }
}