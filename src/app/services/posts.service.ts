import { Injectable } from '@angular/core';
import { Firestore, collection, collectionData, query, orderBy, addDoc, serverTimestamp, doc, updateDoc, increment, getDoc } from '@angular/fire/firestore';
import { Storage, ref, uploadBytes, getDownloadURL } from '@angular/fire/storage'
import { Observable, BehaviorSubject, from, combineLatest, of } from 'rxjs';
import { map, switchMap } from 'rxjs/operators';
import { Auth } from '@angular/fire/auth';
import { Post } from '../models/post.model';
import { PostMedia } from '../models/post.model';

@Injectable({ providedIn: 'root' })
export class PostsService {

  private dashboardStateSubject = new BehaviorSubject<{ count: number; fading: boolean }>({ count: 0, fading: false });
  dashboardState$ = this.dashboardStateSubject.asObservable();

  private seenPosts = new Set<string>();

  constructor(
    private firestore: Firestore,
    private auth: Auth,
    private storage: Storage
  ) {}

  // Real-time posts stream
  getPosts(): Observable<Post[]> {
    const postsRef = collection(this.firestore, 'posts');
    const q = query(postsRef, orderBy('createdAt', 'desc'));

    return collectionData(q, { idField: 'id' }).pipe(
      switchMap((posts: any[]) => {
        if (!posts.length) return of([] as Post[]); // always return Observable<Post[]>

        // Gather unique user IDs
        const uids = [...new Set(posts.map(p => p.uid))];
        const userDocs$ = uids.map(uid => from(getDoc(doc(this.firestore, `users/${uid}`))));

        // Combine all user docs into a map
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
                fadingOut: false
              } as Post;
            });
          })
        );
      })
    );
  }

  // Create post (text-only for now)
  async createPost(caption?: string, files?: File[]) {
    const user = this.auth.currentUser;
    if (!user) throw new Error('Not authenticated');

    const uid = user.uid;

    // Upload media files (if any)
    let media: PostMedia[] | null = null;

    if (files && files.length > 0) {
      media = [];

      for (const file of files) {

        // Validate file type
        if (!file.type.startsWith('image') && !file.type.startsWith('video')) {
          throw new Error('Only images and videos are allowed');
        }

        const filePath = `post-media/${uid}/${Date.now()}_${file.name}`;
        const storageRef = ref(this.storage, filePath);

        // Upload
        await uploadBytes(storageRef, file);

        // Get public URL
        const downloadUrl = await getDownloadURL(storageRef);

        // Build media object
        media.push({
          url: downloadUrl,
          type: file.type.startsWith('video') ? 'video' : 'image'
        });
      }
    }

    // Create Firestore post document
    await addDoc(collection(this.firestore, 'posts'), {
      uid,

      caption: caption || null,
      media: media || null,

      likesCount: 0,
      commentsCount: 0,

      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
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

  // Mark post as seen (UI only)
  markPostAsSeen(postId: string) {
    if (this.seenPosts.has(postId)) return;

    this.seenPosts.add(postId);
    this.updateDashboardState();
  }

  private updateDashboardState() {
    const count = this.seenPosts.size;
    this.dashboardStateSubject.next({ count, fading: false });
  }
}