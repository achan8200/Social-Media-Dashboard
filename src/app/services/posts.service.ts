import { Injectable } from '@angular/core';
import { Firestore, collection, collectionData, query, orderBy, addDoc, serverTimestamp, doc, updateDoc, increment, getDoc, deleteDoc } from '@angular/fire/firestore';
import { Storage, ref, getDownloadURL, uploadBytesResumable, deleteObject } from '@angular/fire/storage'
import { Observable, BehaviorSubject, from, combineLatest, of } from 'rxjs';
import { map, switchMap } from 'rxjs/operators';
import { Auth } from '@angular/fire/auth';
import { Post, PostMedia } from '../models/post.model';

@Injectable({ providedIn: 'root' })
export class PostsService {

  private dashboardStateSubject = new BehaviorSubject<{ count: number; fading: boolean }>({ count: 0, fading: false });
  dashboardState$ = this.dashboardStateSubject.asObservable();

  private seenPostsKey = 'seenPosts';
  private seenPosts = new Set<string>();

  private postsSubject = new BehaviorSubject<Post[]>([]);
  posts$ = this.postsSubject.asObservable();

  constructor(
    private firestore: Firestore,
    private auth: Auth,
    private storage: Storage
  ) {
    // Load seen posts from localStorage
    const saved = localStorage.getItem(this.seenPostsKey);
    if (saved) {
      try {
        const ids = JSON.parse(saved) as string[];
        this.seenPosts = new Set(ids);
      } catch {}
    }

    this.listenToPosts();
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

      caption: caption ?? undefined,
      media: undefined,

      likesCount: 0,
      commentsCount: 0,

      createdAt: new Date(),
      updatedAt: new Date(),

      pending: true
    };

    // Insert immediately into local feed
    this.addPostToLocalFeed(tempPost);

    // Upload media files (if any)
    let media: PostMedia[] | null = null;

    try {
      if (files && files.length > 0) {
        media = [];

        for (let i = 0; i < files.length; i++) {
          const file = files[i];

          // Validate file type
          if (!file.type.startsWith('image') && !file.type.startsWith('video')) {
            throw new Error('Only images and videos are allowed');
          }

          const filePath = `post-media/${uid}/${Date.now()}_${file.name}`;
          const storageRef = ref(this.storage, filePath);

          // Upload
          const uploadTask = uploadBytesResumable(storageRef, file);

          await new Promise<void>((resolve, reject) => {
            uploadTask.on(
              'state_changed',
              (snapshot) => {
                const progress =
                  (snapshot.bytesTransferred / snapshot.totalBytes) * 100;

                if (onProgress) {
                  onProgress(i, progress);
                }
              },
              reject,
              resolve
            );
          });

          // Get public URL
          const downloadUrl = await getDownloadURL(storageRef);

          // Build media object
          media.push({
            url: downloadUrl,
            path: filePath,
            type: file.type.startsWith('video') ? 'video' : 'image',
            thumbnail: file.type.startsWith('video') ? 'assets/video-placeholder.png' : undefined
          });
        }
      }

      // Create Firestore document
      const docRef = await addDoc(collection(this.firestore, 'posts'), {
        uid,
        caption: caption || null,
        media: media || null,
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
              media: media ?? undefined
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

  // Like post (counter only, scalable)
  async likePost(postId: string) {
    const postRef = doc(this.firestore, `posts/${postId}`);
    await updateDoc(postRef, {
      likesCount: increment(1)
    });
  }

  // Increment comment count
  async commentPost(postId: string) {
    const postRef = doc(this.firestore, `posts/${postId}`);

    await updateDoc(postRef, {
      commentsCount: increment(1),
      updatedAt: serverTimestamp()
    });
  }

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

  // Mark post as seen (UI only)
  markPostAsSeen(postId: string) {
    if (this.seenPosts.has(postId)) return;

    this.seenPosts.add(postId);
    localStorage.setItem(this.seenPostsKey, JSON.stringify([...this.seenPosts]));
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