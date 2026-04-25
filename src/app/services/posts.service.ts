import { Injectable } from '@angular/core';
import { Firestore, collection, collectionData, query, orderBy, addDoc, 
  serverTimestamp, doc, updateDoc, increment, getDoc, setDoc, deleteDoc, docData,
  limit, startAfter, getDocs, QueryDocumentSnapshot, 
  DocumentReference, collectionSnapshots, 
  where} from '@angular/fire/firestore';
import { Storage, ref, getDownloadURL, uploadBytesResumable, deleteObject } from '@angular/fire/storage'
import { Auth } from '@angular/fire/auth';
import { Post, PostMedia } from '../models/post.model';
import { Comment, CommentWithLikes } from '../models/comment.model';
import { NotificationsService } from './notifications.service';
import { UserService } from './user.service';
import imageCompression from 'browser-image-compression';
import { Observable, BehaviorSubject, from, combineLatest, of, catchError, map, switchMap } from 'rxjs';

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
    groupId?: string,
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

      groupId,

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

      const payload: any = {
        uid,
        caption: caption || '',
        media,
        likesCount: 0,
        commentsCount: 0,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      };

      if (groupId) {
        payload.groupId = groupId;
      }

      // Create Firestore document
      const docRef = await addDoc(collection(this.firestore, 'posts'), payload);

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
    if (this.likesSubjects.has(postId)) return;

    const likeRef = doc(this.firestore, `posts/${postId}/likes/${uid}`);
    const subj = new BehaviorSubject<boolean>(false);
    this.likesSubjects.set(postId, subj);

    // Listen for real-time updates
    docData(likeRef, { idField: 'id' }).pipe(
      map(docSnap => !!docSnap?.id)
    ).subscribe({
      next: val => subj.next(val),
      error: err => console.error('Failed to listen to like:', err)
    });
  }

  // Returns an Observable of like state for a specific post
  getPostLike(postId: string): Observable<boolean> {
    const uid = this.auth.currentUser?.uid;
    if (!uid) return of(false);

    if (!this.likesSubjects.has(postId)) {
      this.initPostLike(postId, uid);
    }
    return this.likesSubjects.get(postId)!.asObservable();
  }

  // Returns an Observable of the likes count for a specific post
  getPostLikesCount(postId: string): Observable<number> {
    const likesRef = collection(this.firestore, `posts/${postId}/likes`);
    const q = query(likesRef);
    return collectionData(q).pipe(
      map(likes => likes.length)
    );
  }

  // Toggle like locally
  async toggleLikeOptimistic(postId: string) {
    const uid = this.auth.currentUser?.uid;
    if (!uid) return;

    const subj = this.likesSubjects.get(postId) ?? new BehaviorSubject(false);
    this.likesSubjects.set(postId, subj);

    const newValue = !subj.value;
    subj.next(newValue); // optimistic

    try { 
      await this.toggleLike(postId); 
    } catch { 
      subj.next(!newValue); // revert if fails
    }
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

      // Remove the like_post notification if it exists
      const postSnap = await getDoc(doc(this.firestore, `posts/${postId}`));
      if (postSnap.exists()) {
        const post = postSnap.data();
        if (post['uid'] !== uid) {
          await this.notificationsService.deleteNotification({
            recipientUid: post['uid'],
            actorUid: uid,
            type: 'like_post',
            postId: postId
          });
        }
      }

      return false;
    } else {
      // Like: create the like doc
      await setDoc(likeRef, { uid, createdAt: serverTimestamp() });

      // Get post info
      const postSnap = await getDoc(doc(this.firestore, `posts/${postId}`));

      if (postSnap.exists()) {
        const post = postSnap.data();
        if (post['uid'] !== uid) {
          await this.notificationsService.createNotification({
            recipientUid: post['uid'],
            actorUid: uid,
            postOwnerUid: post['uid'],
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

    return collectionSnapshots(q).pipe(
      map(snaps =>
        snaps.map(snap => {
          const data = snap.data() as any;
          let createdAt = data.createdAt;

          // Normalize timestamp to JS Date
          if (createdAt?.toDate && typeof createdAt.toDate === 'function') {
            createdAt = createdAt.toDate();
          } else if (createdAt?.seconds) {
            createdAt = new Date(createdAt.seconds * 1000);
          } else {
            createdAt = new Date(createdAt);
          }

          return {
            id: snap.id,
            ...data,
            createdAt,          // parsed date
            likesCount: data.likesCount || 0
          } as Comment;
        })
      ),
      switchMap(comments => {
        if (!comments.length) return of([]);

        const uids = [...new Set(comments.map(c => c.uid))];

        return combineLatest(
          uids.map(uid => from(getDoc(doc(this.firestore, `users/${uid}`))))
        ).pipe(
          map(snaps => {
            const userMap = new Map(
              snaps.map(s => [s.id, s.exists() ? s.data() : {}])
            );

            return comments.map(c => ({
              ...c,
              likesCount: c.likesCount || 0,
              ...Object.fromEntries(
                Object.entries(userMap.get(c.uid) || {}).filter(
                  ([key]) => key !== 'createdAt'
                )
              )
            })) as Comment[];
          })
        );
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

        const currentIds = new Set(comments.map(c => c.id));

        // Remove deleted comments from map
        for (const key of commentMap.keys()) {
          if (!currentIds.has(key)) {
            commentMap.delete(key);
          }
        }

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

    const commentDocRef = await addDoc(commentsRef, {
      uid: user.uid,
      text: text,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });

    // Get the generated comment ID
    const commentId = commentDocRef.id;

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
          postOwnerUid: post['uid'],
          type: 'comment_post',
          postId: postId,
          commentId
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
    const commentSnap = await getDoc(commentRef);
    const commentData = commentSnap.exists() ? commentSnap.data() : null;
    if (!commentData) return; // Comment already deleted

    // Delete all likes on this comment and their notifications
    const commentLikesSnap = await getDocs(collection(this.firestore, `posts/${postId}/comments/${commentId}/likes`));
    for (const likeDoc of commentLikesSnap.docs) {
      const likerUid = likeDoc.id;

      try {
        await this.notificationsService.deleteNotification({
          recipientUid: commentData['uid'],
          actorUid: likerUid,
          type: 'like_comment',
          postId,
          commentId
        });
      } catch (err) {
        console.warn('Failed to delete notification', err);
      }

      await deleteDoc(likeDoc.ref);
    }

    // Remove 'comment_post' notification sent to post author
    const postRef = doc(this.firestore, `posts/${postId}`);
    const postSnap = await getDoc(postRef);
    const postData = postSnap.exists() ? postSnap.data() : null;

    if (postData?.['uid'] && postData['uid'] !== user.uid) {
      try {
        await this.notificationsService.deleteNotification({
          recipientUid: postData['uid'], // post author
          actorUid: commentData['uid'],            // comment author (who deleted)
          type: 'comment_post',
          postId,
          commentId
        });
      } catch (err) {
        console.warn('Failed to delete notification', err);
      }
    }

    // Delete the comment itself
    await deleteDoc(commentRef);

    // Update post comment counter
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
    const commentsRef = collection(this.firestore, `posts/${postId}/comments`);
    return collectionData(commentsRef).pipe(
      map(comments => comments.length)
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
      // Delete the notification for this like
      const commentSnap = await getDoc(commentRef);
      if (commentSnap.exists()) {
        const comment = commentSnap.data();
        if (comment['uid'] !== uid) {
          try {
            await this.notificationsService.deleteNotification({
              recipientUid: comment['uid'], // author of the comment
              actorUid: uid,               // the user who unliked
              type: 'like_comment',
              postId,
              commentId
            });
          } catch (err) {
            console.warn('Failed to delete notification', err);
          }
        }
      }
    } else {
      // Like
      await setDoc(likeRef, { uid, createdAt: serverTimestamp() });
      await updateDoc(commentRef, { likesCount: increment(1) });
      subj.next(true);

      // Fetch post to determine owner
      const postSnap = await getDoc(doc(this.firestore, `posts/${postId}`));

      // Fetch comment to determine author
      const commentSnap = await getDoc(commentRef);

      if (commentSnap.exists() && postSnap.exists()) {
        const post = postSnap.data();
        const comment = commentSnap.data();

        // Prevent self-notifications
        if (comment['uid'] !== uid) {
          await this.notificationsService.createNotification({
            recipientUid: comment['uid'],
            actorUid: uid,
            postOwnerUid: post['uid'],
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
    const postRef = doc(this.firestore, `posts/${postId}`);
    const postSnap = await getDoc(postRef);
    const postData = postSnap.exists() ? postSnap.data() : null;
    if (!postData) return; // post already deleted
    const postOwnerUid = postData['uid'];

    // Delete likes on the post and their notifications
    const likesSnap = await getDocs(collection(this.firestore, `posts/${postId}/likes`));
    for (const likeDoc of likesSnap.docs) {
      const likeData = likeDoc.data();

      if (likeData?.['uid'] && postOwnerUid) {
        try {
          await this.notificationsService.deleteNotification({
            recipientUid: postOwnerUid,    // post owner
            actorUid: likeData['uid'],     // user who liked
            type: 'like_post',
            postId
          });
        } catch (err) {
          console.warn('Failed to delete like_post notification', err);
        }
      }

      await deleteDoc(likeDoc.ref);
    }

    // Delete comments and comment likes
    const commentsSnap = await getDocs(collection(this.firestore, `posts/${postId}/comments`));
    for (const commentDoc of commentsSnap.docs) {
      const commentData = commentDoc.data();
      const commentId = commentDoc.id;
      const commentAuthorUid = commentData?.['uid'];

      // Delete likes on this comment and their notifications
      const commentLikesSnap = await getDocs(collection(this.firestore, `posts/${postId}/comments/${commentId}/likes`));
      for (const likeDoc of commentLikesSnap.docs) {
        const likerUid = likeDoc.id;

        try {
          await this.notificationsService.deleteNotification({
            recipientUid: commentData['uid'],
            actorUid: likerUid,
            type: 'like_comment',
            postId,
            commentId
          });
        } catch (err) {
          console.warn('Failed to delete notification', err);
        }

        await deleteDoc(likeDoc.ref);
      }

      // Delete comment notifications (sent to post owner)
      if (commentAuthorUid && postOwnerUid && postOwnerUid !== commentAuthorUid) {
        try {
          await this.notificationsService.deleteNotification({
            recipientUid: postOwnerUid,    // post owner
            actorUid: commentAuthorUid,    // comment author
            type: 'comment_post',
            postId,
            commentId
          });
        } catch (err) {
          console.warn('Failed to delete notification', err);
        }
      }

      // Delete the comment itself
      await deleteDoc(commentDoc.ref);
    }

    // Delete the post document itself
    await deleteDoc(postRef);
  }

  /** -------------------- GROUP POSTS -------------------- */

  getPostsByGroup(groupId: string): Observable<Post[]> {
    const postsRef = collection(this.firestore, 'posts');

    const q = query(
      postsRef,
      where('groupId', '==', groupId),
      orderBy('createdAt', 'desc')
    );

    return collectionData(q, { idField: 'id' }) as Observable<Post[]>;
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

  getPostCaption(postId: string): Observable<string | null> {
    const postRef = doc(this.firestore, `posts/${postId}`) as DocumentReference<Post>;
    return docData(postRef, { idField: 'id' }).pipe(
      map(post => post?.caption ?? '')
    );
  }
}