import { Injectable } from '@angular/core';
import { Firestore, collection, collectionData, query, orderBy, addDoc, 
  serverTimestamp, doc, updateDoc, increment, getDoc, setDoc, deleteDoc, docData,
  limit, startAfter, getDocs, QueryDocumentSnapshot } from '@angular/fire/firestore';
import { Storage, ref, getDownloadURL, uploadBytesResumable, deleteObject } from '@angular/fire/storage'
import { Observable, BehaviorSubject, from, combineLatest, of } from 'rxjs';
import { catchError, map, switchMap } from 'rxjs/operators';
import { Auth } from '@angular/fire/auth';
import { Post, PostMedia } from '../models/post.model';
import { Comment, CommentWithLikes } from '../models/comment.model';
import imageCompression from 'browser-image-compression';
import { NotificationsService } from './notifications.service';
import { UserService } from './user.service';

@Injectable({ providedIn: 'root' })
export class PostsService {

  private dashboardStateSubject = new BehaviorSubject<{ count: number; fading: boolean }>({ count: 0, fading: false });
  dashboardState$ = this.dashboardStateSubject.asObservable();

  private seenPostsKey = 'seenPosts';
  private seenPosts = new Set<string>();
  private postsCacheKey = 'cachedPosts';

  private postsSubject = new BehaviorSubject<Post[]>([]);
  posts$ = this.postsSubject.asObservable();

  private postSubjects = new Map<string, BehaviorSubject<Post>>();
  private likesSubjects = new Map<string, BehaviorSubject<boolean>>();
  private commentLikesSubjects = new Map<string, BehaviorSubject<boolean>>();

  private lastVisiblePost: QueryDocumentSnapshot | null = null;
  private loadingMore = false;
  private pageSize = 10;
  private noMorePosts = false;

  constructor(
    private firestore: Firestore,
    private auth: Auth,
    private storage: Storage,
    private notificationsService: NotificationsService,
    private userService: UserService
  ) {
    // Defer loading browser-only state until we're sure we're in the browser
    this.safeLoadSeenPosts();

    this.loadCachedPosts();

    // Start listening to posts (Firestore queries are safe in both SSR and browser)
    this.loadInitialPosts();

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

  /** -------------------- POSTS STREAMS -------------------- */

  getPosts(): Observable<Post[]> {
    return this.posts$;
  }

  getPostStream(postId: string): Observable<Post> {
    if (!this.postSubjects.has(postId)) {
      const subj = new BehaviorSubject<Post>(null!);
      // Initialize from Firestore
      const postRef = doc(this.firestore, `posts/${postId}`);
      docData(postRef, { idField: 'id' }).subscribe(post => subj.next(post as Post));
      this.postSubjects.set(postId, subj);
    }
    return this.postSubjects.get(postId)!.asObservable();
  }

  getPostById(postId: string): Observable<Post | null> {
    const postRef = doc(this.firestore, `posts/${postId}`);
    return docData(postRef, { idField: 'id' }).pipe(
      map(data => {
        if (!data) return null;
        return data as Post;
      })
    );
  }

  /** -------------------- LOAD POSTS -------------------- */

  async loadInitialPosts() {
    const postsRef = collection(this.firestore, 'posts');
    const q = query(postsRef, orderBy('createdAt', 'desc'), limit(this.pageSize));
    const snapshot = await getDocs(q);
    if (snapshot.empty) return;

    this.lastVisiblePost = snapshot.docs[snapshot.docs.length - 1];
    const posts = snapshot.docs.map(d => ({ id: d.id, ...d.data() })) as Post[];
    this.postsSubject.next(posts);
    this.savePostsCache(posts);
  }

  async loadMorePosts() {
    if (this.loadingMore || this.noMorePosts || !this.lastVisiblePost) return;
    this.loadingMore = true;

    const postsRef = collection(this.firestore, 'posts');
    const q = query(postsRef, orderBy('createdAt', 'desc'), startAfter(this.lastVisiblePost), limit(this.pageSize));
    const snapshot = await getDocs(q);
    if (snapshot.empty) {
      this.noMorePosts = true;
      this.loadingMore = false;
      return;
    }

    this.lastVisiblePost = snapshot.docs[snapshot.docs.length - 1];
    const newPosts = snapshot.docs.map(d => ({ id: d.id, ...d.data() })) as Post[];
    this.postsSubject.next([...this.postsSubject.value, ...newPosts]);
    this.savePostsCache(this.postsSubject.value);
    this.loadingMore = false;
  }

  /** -------------------- LOCAL CACHE -------------------- */

  private loadCachedPosts() {
    if (typeof window === 'undefined') return;
    try {
      const cached = localStorage.getItem(this.postsCacheKey);
      if (cached) {
        const posts = JSON.parse(cached).slice(0, 30);
        this.postsSubject.next(posts);
      }
    } catch { console.warn('Failed to load cached posts'); }
  }

  private savePostsCache(posts: Post[]) {
    if (typeof window === 'undefined') return;
    try { localStorage.setItem(this.postsCacheKey, JSON.stringify(posts)); } 
    catch { console.warn('Failed to cache posts'); }
  }

  /** -------------------- SEEN POSTS -------------------- */

  private safeLoadSeenPosts() {
    if (typeof window === 'undefined' || !window.localStorage) return;
    try {
      const saved = localStorage.getItem(this.seenPostsKey);
      if (saved) this.seenPosts = new Set(JSON.parse(saved));
    } catch { this.seenPosts = new Set(); }
    this.updateDashboardState();
  }

  markPostAsSeen(postId: string) {
    if (!this.seenPosts.has(postId)) {
      this.seenPosts.add(postId);
      if (typeof window !== 'undefined') localStorage.setItem(this.seenPostsKey, JSON.stringify([...this.seenPosts]));
      this.updateDashboardState();
    }
  }

  hasSeen(postId: string): boolean {
    return this.seenPosts.has(postId);
  }

  private updateDashboardState() {
    const count = this.seenPosts.size;
    this.dashboardStateSubject.next({ count, fading: false });
  }

  /** -------------------- POSTS -------------------- */

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
        await Promise.all(files.map(async (file, i) => {
          return new Promise<void>(async (resolve, reject) => {
            if (!file.type.startsWith('image') && !file.type.startsWith('video')) {
              return reject(new Error('Only images and videos are allowed'));
            }

            let uploadFile = file;

            // Compress images only
            if (file.type.startsWith('image')) {
              uploadFile = await this.compressImage(file);
            }

            const filePath = `post-media/${uid}/${Date.now()}_${uploadFile.name}`;
            const storageRef = ref(this.storage, filePath);

            // Upload
            const uploadTask = uploadBytesResumable(storageRef, uploadFile);

            uploadTask.on('state_changed',
              snapshot => {
                const progress = Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100);
                if (onProgress) onProgress(i, progress);
              },
              error => reject(error),
              async () => {
                const downloadUrl = await getDownloadURL(storageRef);
                media[i] = {
                  url: downloadUrl,
                  path: filePath,
                  type: file.type.startsWith('video') ? 'video' : 'image',
                  ...(file.type.startsWith('video') && { thumbnail: 'assets/video-placeholder.png' })
                };
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
      const updatedPosts = this.postsSubject.value.map(p =>
        p.id === tempId
          ? {
              ...p,
              id: docRef.id, // Replace tempId
              username: userData?.['username'] || p.username,
              displayName: userData?.['displayName'] || p.displayName,
              userAvatar: userData?.['profilePicture'] || p.userAvatar,
              media,
              pending: false
            }
          : p
      );

      this.postsSubject.next(updatedPosts);
      this.savePostsCache(updatedPosts);

      // Update seenPosts
      if (this.seenPosts.has(tempId)) {
        this.seenPosts.delete(tempId);
        this.seenPosts.add(docRef.id);

        // Save updated seenPosts to localStorage
        if (typeof window !== 'undefined' && window.localStorage) {
          localStorage.setItem(this.seenPostsKey, JSON.stringify([...this.seenPosts]));
        }
      }
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

  /** -------------------- LIKES -------------------- */

  private initPostLike(postId: string, uid: string) {
    if (!this.likesSubjects.has(postId)) {
      const subj = new BehaviorSubject<boolean>(false);
      this.likesSubjects.set(postId, subj);
      const likeRef = doc(this.firestore, `posts/${postId}/likes/${uid}`);
      docData(likeRef, { idField: 'id' }).pipe(map(d => !!d?.id)).subscribe(subj);
    }
  }

  // Returns an Observable of like state for a specific post
  getPostLike(postId: string): Observable<boolean> {
    if (!this.likesSubjects.has(postId)) {
      const uid = this.auth.currentUser?.uid;
      if (uid) this.initPostLike(postId, uid);
      else this.likesSubjects.set(postId, new BehaviorSubject(false));
    }
    return this.likesSubjects.get(postId)!.asObservable();
  }

  // Returns an Observable of the likes count for a specific post
  getPostLikesCount(postId: string): Observable<number> {
    return this.posts$.pipe(map(posts => posts.find(p => p.id === postId)?.likesCount ?? 0));
  }

  // Toggle like locally
  async toggleLikeOptimistic(postId: string) {
    const uid = this.auth.currentUser?.uid;
    if (!uid) return;

    const subj = this.likesSubjects.get(postId) ?? new BehaviorSubject(false);
    this.likesSubjects.set(postId, subj);
    const newValue = !subj.value;
    subj.next(newValue);

    this.updatePostLocal(postId, p => p.likesCount = (p.likesCount || 0) + (newValue ? 1 : -1));
    try { await this.toggleLike(postId); } catch { subj.next(!newValue); }
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

      // Get post info
      const postSnap = await getDoc(doc(this.firestore, `posts/${postId}`));

      if (postSnap.exists()) {
        const post = postSnap.data();
        if (post['uid'] !== uid) {
          await this.notificationsService.createNotification({
            recipientUid: post['uid'],
            actorUid: uid,
            type: 'like_post',
            postId: postId
          });
        }
      }
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

  /** -------------------- COMMENTS -------------------- */

  // Fetch comments
  getComments(postId: string): Observable<Comment[]> {
    const commentsRef = collection(this.firestore, `posts/${postId}/comments`);
    const q = query(commentsRef, orderBy('createdAt', 'asc'));
    return collectionData(q, { idField: 'id' }).pipe(
      switchMap(comments => {
        if (!comments.length) return of([]);
        const uids = [...new Set(comments.map(c => c['uid']))];
        return combineLatest(uids.map(uid => from(getDoc(doc(this.firestore, `users/${uid}`)))))
          .pipe(map(snaps => {
            const userMap = new Map(snaps.map(s => [s.id, s.exists() ? s.data() : {}]));
            return comments.map(c => ({ ...c, likesCount: c['likesCount'] || 0, ...userMap.get(c['uid']) })) as Comment[];
          }));
      })
    );
  }

  getCommentsStream(postId: string): Observable<CommentWithLikes[]> {
    const commentMap = new Map<string, CommentWithLikes>();

    const commentsRef = collection(this.firestore, `posts/${postId}/comments`);
    const q = query(commentsRef, orderBy('createdAt', 'asc'));

    return collectionData(q, { idField: 'id' }).pipe(
      map(comments => {
        const result: CommentWithLikes[] = [];

        comments.forEach(comment => {
          let existing = commentMap.get(comment.id!);

          if (!existing) {
            const uid = comment['uid'];

            const username$ = this.userService.getUserByUid(uid).pipe(
              map(u => u?.username ?? 'Unknown')
            );
            const userAvatar$ = this.userService.getUserByUid(uid).pipe(
              map(u => u?.profilePicture ?? null)
            );
            const liked$ = this.getCommentLike(postId, comment.id!);

            existing = { ...comment, username$, userAvatar$, liked$ } as CommentWithLikes;
            commentMap.set(comment.id!, existing);
          } else {
            // update mutable fields only
            existing.text = comment['text'];
            existing.likesCount = comment['likesCount'] || 0;
            existing.updatedAt = comment['updatedAt'] || existing.updatedAt;
          }

          result.push(existing);
        });

        return result;
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

    // Fetch post to determine owner
    const postSnap = await getDoc(doc(this.firestore, `posts/${postId}`));

    if (postSnap.exists()) {
      const post = postSnap.data();
      if (post['uid'] !== user.uid) {
        await this.notificationsService.createNotification({
          recipientUid: post['uid'],
          actorUid: user.uid,
          type: 'comment_post',
          postId: postId
        });
      }
    }
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

  // Delete a comment and all its subcollections (likes)
  async deleteComment(postId: string, commentId: string) {
    const user = this.auth.currentUser;
    if (!user) throw new Error('Not authenticated');

    const commentRef = doc(this.firestore, `posts/${postId}/comments/${commentId}`);

    // Delete comment likes
    const likesSnap = await getDocs(collection(this.firestore, `posts/${postId}/comments/${commentId}/likes`));
    for (const likeDoc of likesSnap.docs) {
      await deleteDoc(likeDoc.ref);
    }

    // Delete the comment itself
    await deleteDoc(commentRef);

    // Update post comment counter
    const postRef = doc(this.firestore, `posts/${postId}`);
    await updateDoc(postRef, {
      commentsCount: increment(-1),
      updatedAt: serverTimestamp()
    });

    // Clean up any local state / subjects
    const key = `${user.uid}_${postId}_${commentId}`;
    if (this.commentLikesSubjects.has(key)) {
      this.commentLikesSubjects.delete(key);
    }
  }

  getPostCommentsCount(postId: string): Observable<number> {
    return this.posts$.pipe(
      map(posts => posts.find(p => p.id === postId)?.commentsCount ?? 0)
    );
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

      // Fetch comment to determine author
      const commentSnap = await getDoc(commentRef);

      if (commentSnap.exists()) {
        const comment = commentSnap.data();

        // Prevent self-notifications
        if (comment['uid'] !== uid) {
          await this.notificationsService.createNotification({
            recipientUid: comment['uid'],
            actorUid: uid,
            type: 'like_comment',
            postId: postId,
            commentId: commentId
          });
        }
      }
    }
  }

  // Observable for likes count of a comment
  getCommentLikesCount(postId: string, commentId: string): Observable<number> {
    const commentsRef = doc(this.firestore, `posts/${postId}/comments/${commentId}`);
    return docData(commentsRef).pipe(
      map((comment: any) => comment?.likesCount || 0)
    );
  }

  /** -------------------- DELETE POSTS -------------------- */

  // Fully delete a post and all its subcollections
  async deletePost(post: Post) {
    const user = this.auth.currentUser;
    if (!user) throw new Error('Not authenticated');
    if (user.uid !== post.uid) throw new Error('Unauthorized delete attempt');

    // Delete all media in Storage
    if (post.media?.length) {
      for (const media of post.media) {
        try {
          await deleteObject(ref(this.storage, media.path));
        } catch (err) {
          console.warn('Failed to delete media:', err);
        }
      }
    }

    // Recursively delete likes, comments, and comment likes
    await this.deletePostRecursive(post.id);

    // Remove post from local feed & cache
    const updated = this.postsSubject.value.filter(p => p.id !== post.id);
    this.postsSubject.next(updated);
    this.savePostsCache(updated);

    // Remove from seenPosts if present
    if (this.seenPosts.has(post.id)) {
      this.seenPosts.delete(post.id);
      if (typeof window !== 'undefined' && window.localStorage) {
        localStorage.setItem('seenPosts', JSON.stringify([...this.seenPosts]));
      }
      this.updateDashboardState();
    }
  }

  // Helper: Recursively delete all subcollections
  private async deletePostRecursive(postId: string) {
    const postDocRef = doc(this.firestore, `posts/${postId}`);

    // Delete likes
    const likesSnap = await getDocs(collection(this.firestore, `posts/${postId}/likes`));
    for (const likeDoc of likesSnap.docs) {
      await deleteDoc(likeDoc.ref);
    }

    // Delete comments and comment likes
    const commentsSnap = await getDocs(collection(this.firestore, `posts/${postId}/comments`));
    for (const commentDoc of commentsSnap.docs) {
      // Delete comment likes
      const commentLikesSnap = await getDocs(collection(this.firestore, `posts/${postId}/comments/${commentDoc.id}/likes`));
      for (const likeDoc of commentLikesSnap.docs) {
        await deleteDoc(likeDoc.ref);
      }

      // Delete comment itself
      await deleteDoc(commentDoc.ref);
    }

    // Delete the post document itself
    await deleteDoc(postDocRef);
  }

  /** -------------------- UTILS -------------------- */

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

  private async compressImage(file: File): Promise<File> {
    const options = {
      maxSizeMB: 0.5,        // target ~500kb
      maxWidthOrHeight: 1920,
      useWebWorker: true
    };

    try {
      const compressed = await imageCompression(file, options);
      return compressed;
    } catch (error) {
      console.warn('Image compression failed, using original', error);
      return file;
    }
  }
}