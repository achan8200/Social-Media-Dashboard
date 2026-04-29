import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, ElementRef, inject, ViewChild } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Firestore, collection, query, where, getDocs, doc, serverTimestamp, setDoc, docData, collectionData } from '@angular/fire/firestore';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { PostsService } from '../../services/posts.service';
import { Post } from '../../models/post.model';
import { PostModal } from "../../components/post-modal/post-modal";
import { CreatePostModal } from "../../components/create-post-modal/create-post-modal";
import { FollowService } from '../../services/follow.service';
import { MessagesService } from '../../services/messages.service';
import { getInitial, getAvatarColor } from '../../utils/avatar';
import { trigger, style, transition, animate } from '@angular/animations';
import { Observable, map, from, combineLatest, switchMap, of, debounceTime, distinctUntilChanged, shareReplay, tap, finalize, firstValueFrom } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

type UsernameStatus =
  | 'available'
  | 'invalid'
  | 'taken'
  | null;

@Component({
  selector: 'app-profile',
  standalone: true,
  imports: [CommonModule, RouterModule, ReactiveFormsModule, PostModal, CreatePostModal],
  templateUrl: './profile.html',
  styleUrl: './profile.css',
  animations: [
    trigger('overlayFade', [
      transition(':enter', [style({ opacity: 0 }), animate('200ms ease-out', style({ opacity: 1 }))]),
      transition(':leave', [animate('150ms ease-in', style({ opacity: 0 }))])
    ]),
    trigger('modalScale', [
      transition(':enter', [style({ opacity: 0, transform: 'scale(0.95)' }), animate('200ms ease-out', style({ opacity: 1, transform: 'scale(1)' }))]),
      transition(':leave', [animate('150ms ease-in', style({ opacity: 0, transform: 'scale(0.95)' }))])
    ])
  ]
})
export class Profile {
  private firestore = inject(Firestore);
  private fb = inject(FormBuilder);
  private authService = inject(AuthService);
  private cdr = inject(ChangeDetectorRef);
  private route = inject(ActivatedRoute);
  private followService = inject(FollowService);
  private router = inject(Router);
  private messagesService = inject(MessagesService);

  profile$!: Observable<any>;
  isOwner$!: Observable<boolean>;
  isGuest$!: Observable<boolean>;
  userPostCount$!: Observable<number>;
  userPosts$!: Observable<Post[]>;

  followerCount$!: Observable<number>;
  followingCount$!: Observable<number>;
  groupsCount$!: Observable<number>;

  editMode = false;
  originalProfile: any = null;
  hasChanges$!: Observable<boolean>;

  showCreateModal = false;
  selectedPost: Post | null = null;

  usernameStatus$!: Observable<UsernameStatus>;
  currentUsernameStatus: UsernameStatus = null;
  checkingUsername = false;
  isSaving = false;
  showRemoveConfirm = false;

  following = false;

  profileForm = this.fb.group({
    displayName: ['', Validators.required],
    username: ['', Validators.required],
    bio: [''],
    profilePicture: ['']
  });

  // Crop state
  cropImageSrc: string | null = null;
  crop = {
    x: 0,
    y: 0,
    scale: 1
  };

  // Track image natural size
  imageNaturalWidth = 0;
  imageNaturalHeight = 0;

  // Display size (normalized)
  imageDisplayWidth = 0;
  imageDisplayHeight = 0;

  @ViewChild('cropCircle') cropCircle!: ElementRef<HTMLDivElement>;

  private isDragging = false;
  private lastMouseX = 0;
  private lastMouseY = 0;

  // Touch pinch state
  private isPinching = false;
  private initialPinchDistance = 0;
  private initialScale = 1;
  minScale = 1;

  constructor(private postsService: PostsService) {
    this.loadProfileFromRoute();
    this.usernameStatus$ = this.profileForm.get('username')!
    .valueChanges
    .pipe(
      map(value => value?.trim().toLowerCase() ?? ''),
      debounceTime(400),
      distinctUntilChanged(),
      tap(() => {
        this.checkingUsername = true;
        this.cdr.detectChanges();
      }),
      switchMap(trimmed => {
        if (!this.editMode || !this.originalProfile) {
          this.checkingUsername = false;
          this.cdr.detectChanges();
          return of(null);
        }

        const original = this.originalProfile.username
        ?.trim()
        .toLowerCase();

        if (trimmed === original) {
          this.checkingUsername = false;
          this.cdr.detectChanges();
          return of(null);
        }

        const validationError = this.authService.validateUsername(trimmed);
        if (validationError) {
          this.checkingUsername = false;
          this.cdr.detectChanges();
          return of('invalid' as const);
        }

        return from(this.authService.isUsernameUnique(trimmed)).pipe(
          map(isUnique => isUnique ? ('available' as const) : ('taken' as const)),
          finalize(() => {
            this.checkingUsername = false;
            this.cdr.detectChanges();
          })
        );
      }),
      shareReplay(1)
    );


    this.profile$
    .pipe(takeUntilDestroyed())
    .subscribe(profile => {
      if (!profile) return;

      this.originalProfile = profile;

      // Keep form in sync when NOT editing
      if (!this.editMode) {
        this.profileForm.patchValue({
          displayName: profile.displayName ?? '',
          username: profile.username ?? '',
          bio: profile.bio ?? ''
        }, { emitEvent: false });
      }
    });

    this.hasChanges$ = this.profileForm.valueChanges.pipe(
      map(values => {
        if (!this.originalProfile) return false;

        return (
          values.displayName !== this.originalProfile.displayName ||
          values.username !== this.originalProfile.username ||
          values.bio !== this.originalProfile.bio
        );
      })
    );

    this.isOwner$ = combineLatest([
      this.authService.user$,
      this.profile$
    ]).pipe(
      map(([authUser, profile]) => {
        if (!authUser || !profile) return false;
        return authUser.uid === profile.uid;
      }),
      shareReplay(1)
    );

    this.usernameStatus$.subscribe(status => {
      this.currentUsernameStatus = status;
      this.cdr.detectChanges(); // optional to immediately update the button
    });

    this.userPostCount$ = this.profile$.pipe(
      switchMap(profile => {
        if (!profile) return of(0);

        return this.postsService.posts$.pipe(
          map(posts => posts.filter(p => p.uid === profile.uid).length)
        );
      })
    );

    this.userPosts$ = this.profile$.pipe(
      switchMap(profile => {
        if (!profile) return of([]);
        return this.postsService.posts$.pipe(
          map(posts => {
            return posts
              .filter(p => p.uid === profile.uid)
              .map(post => {
                // Only add dynamic properties if they don't exist yet
                if (post.isNew === undefined) {
                  post.isNew = !this.postsService.hasSeen(post.id);
                  post.fadingOut = false;
                }
                return post;
              });
          })
        );
      })
    );

    // Follower count
    this.followerCount$ = this.profile$.pipe(
      switchMap(profile => {
        if (!profile) return of(0);

        const followersRef = collection(this.firestore, `users/${profile.uid}/followers`);
        return collectionData(followersRef).pipe(
          map(followers => followers.length) // counts the docs in real-time
        );
      })
    );

    // Following count
    this.followingCount$ = this.profile$.pipe(
      switchMap(profile => {
        if (!profile) return of(0);

        const followingRef = collection(this.firestore, `users/${profile.uid}/following`);
        return collectionData(followingRef).pipe(
          map(following => following.length)
        );
      })
    );

    // Groups count
    this.groupsCount$ = this.profile$.pipe(
      switchMap(profile => {
        if (!profile) return of(0);

        const groupsRef = collection(
          this.firestore,
          `users/${profile.uid}/groups`
        );

        return collectionData(groupsRef, { idField: 'id' }).pipe(
          map(groups => groups.length),
          shareReplay(1)
        );
      })
    );

    combineLatest([this.authService.user$, this.profile$])
    .pipe(
      switchMap(([authUser, profile]) => {
        if (!authUser || !profile) return of(false);
        const docRef = doc(this.firestore, `users/${profile.uid}/followers/${authUser.uid}`);
        return docData(docRef, { idField: 'id' }).pipe(
          map(followerDoc => !!followerDoc)
        );
      })
    )
    .subscribe(isFollowing => {
      this.following = isFollowing;
      this.cdr.detectChanges();
    });

    // Optional but VERY useful while debugging
    /*
    this.isOwner$.subscribe(isOwner => {
      console.log('[PROFILE] isOwner =', isOwner);
    });

    this.profile$.subscribe(p => {
      console.log('[PROFILE STREAM]', p);
    }); */
  }

  ngOnInit() {
    // Determine if user is logged in
    this.isGuest$ = this.authService.user$.pipe(
      map(user => !user)  // true if no user is logged in
    );
  }

  // Load profile based on /u/:username or /profile/:userId
  private loadProfileFromRoute() {
    this.profile$ = this.route.paramMap.pipe(
      switchMap(params => {
        const username = params.get('username');
        const userIdParam = params.get('userId');

        // ─────────────────────────────
        // /u/:username
        // ─────────────────────────────
        if (username) {
          const usersRef = collection(this.firestore, 'users');
          const q = query(
            usersRef,
            where('username', '==', username.toLowerCase())
          );

          return from(getDocs(q)).pipe(
            switchMap(snapshot => {
              if (snapshot.empty) {
                console.warn('[PROFILE] No user found for username:', username);
                return  of(null);
              }

              const docSnap = snapshot.docs[0];
              const userRef = doc(this.firestore, `users/${docSnap.id}`);

              return docData(userRef, { idField: 'uid' });
            })
          );
        }

        // ─────────────────────────────
        // /profile/:userId
        // ─────────────────────────────
        if (userIdParam) {
          const userId = Number(userIdParam);
          if (isNaN(userId)) return of(null);

          const usersRef = collection(this.firestore, 'users');
          const q = query(usersRef, where('userId', '==', userId));

          return from(getDocs(q)).pipe(
            switchMap(snapshot => {
              if (snapshot.empty) {
                console.warn('[PROFILE] No user found for userId:', userId);
                return of(null);
              }

              const docSnap = snapshot.docs[0];
              const userRef = doc(this.firestore, `users/${docSnap.id}`);

              return docData(userRef, { idField: 'uid' });
            })
          );
        }

        return of(null);
      }),
      shareReplay(1)
    );
  }


  // Profile picture selection
  onProfilePictureSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    if (!input.files || !input.files[0]) return;

    const file = input.files[0];
    if (!file.type.startsWith('image/')) return;

    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.src = reader.result as string;

      img.onload = () => {
        this.cropImageSrc = img.src;

        this.imageNaturalWidth = img.width;
        this.imageNaturalHeight = img.height;

        // Normalize large images
        const maxDim = 512;
        const scale = Math.min(
          maxDim / img.width,
          maxDim / img.height,
          1
        );

        this.imageDisplayWidth = img.width * scale;
        this.imageDisplayHeight = img.height * scale;

        const circleSize = 256;

        this.minScale = Math.max(
          circleSize / this.imageDisplayWidth,
          circleSize / this.imageDisplayHeight
        );

        this.crop = {
          x: 0,
          y: 0,
          scale: this.minScale
        };

        input.value = '';
        this.cdr.detectChanges();
      };
    };
    reader.readAsDataURL(file);
  }

  // Drag and zoom handlers
  startDrag(event: MouseEvent | TouchEvent) {
    if (event instanceof TouchEvent && event.touches.length === 2) {
      this.isPinching = true;

      const dx = event.touches[0].clientX - event.touches[1].clientX;
      const dy = event.touches[0].clientY - event.touches[1].clientY;

      this.initialPinchDistance = Math.sqrt(dx * dx + dy * dy);
      this.initialScale = this.crop.scale;
      return;
    }

    this.isDragging = true;

    const point = event instanceof MouseEvent
      ? event
      : event.touches[0];

    this.lastMouseX = point.clientX;
    this.lastMouseY = point.clientY;
  }


  drag(event: MouseEvent | TouchEvent) {
    if (this.isPinching && event instanceof TouchEvent && event.touches.length === 2) {
      const dx = event.touches[0].clientX - event.touches[1].clientX;
      const dy = event.touches[0].clientY - event.touches[1].clientY;

      const distance = Math.sqrt(dx * dx + dy * dy);
      const scaleChange = distance / this.initialPinchDistance;

      const newScale = this.initialScale * scaleChange;
      this.crop.scale = Math.max(this.minScale, Math.min(3, newScale));

      this.clampPosition();
      return;
    }

    if (!this.isDragging) return;

    const point = event instanceof MouseEvent
      ? event
      : event.touches[0];

    const dx = point.clientX - this.lastMouseX;
    const dy = point.clientY - this.lastMouseY;

    this.crop.x += dx / this.crop.scale;
    this.crop.y += dy / this.crop.scale;

    this.lastMouseX = point.clientX;
    this.lastMouseY = point.clientY;

    this.clampPosition();
  }

  endDrag() {
    this.isDragging = false;
    this.isPinching = false;
  }

  zoom(delta: number) {
    const newScale = this.crop.scale + delta;
    this.crop.scale = Math.max(this.minScale, Math.min(3, newScale));
    this.clampPosition();
  }

  clampPosition() {
    const circleSize = 256;

    const scaledWidth = this.imageDisplayWidth * this.crop.scale;
    const scaledHeight = this.imageDisplayHeight * this.crop.scale;

    const maxX = Math.max(0, (scaledWidth - circleSize) / 2);
    const maxY = Math.max(0, (scaledHeight - circleSize) / 2);

    this.crop.x = Math.max(-maxX, Math.min(maxX, this.crop.x));
    this.crop.y = Math.max(-maxY, Math.min(maxY, this.crop.y));
  }

  onSliderChange(event: Event) {
    const value = (event.target as HTMLInputElement).valueAsNumber;
    this.crop.scale = Math.max(this.minScale, Math.min(3, value));
    this.clampPosition();
  }

  // Save cropped image
  async saveCroppedProfilePicture() {
    const currentUser = await firstValueFrom(this.authService.user$);
    if (!currentUser || !this.cropImageSrc) return;

    const avatarSize = 256;

    const croppedBase64 = await this.cropAndResize(
      this.cropImageSrc,
      avatarSize,
      this.crop.x,
      this.crop.y,
      this.crop.scale
    );

    // Save to Firestore
    const userRef = doc(this.firestore, `users/${currentUser.uid}`);
    await setDoc(userRef, { profilePicture: croppedBase64, updatedAt: serverTimestamp() }, { merge: true });

    // Update form and close modal
    this.profileForm.patchValue({ profilePicture: croppedBase64 });
    this.cropImageSrc = null;
  }

  async cropAndResize(
    src: string,
    size: number,
    offsetX: number,
    offsetY: number,
    scale: number
  ): Promise<string> {
    return new Promise((resolve) => {
      const img = new Image();
      img.src = src;

      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;

        const ctx = canvas.getContext('2d')!;

        // Move origin to center
        ctx.translate(size / 2, size / 2);

        // Apply offset
        ctx.translate(offsetX, offsetY);

        // Apply scale
        ctx.scale(scale, scale);

        // Draw image centered with offset
        ctx.drawImage(
          img,
          -this.imageDisplayWidth / 2,
          -this.imageDisplayHeight / 2,
          this.imageDisplayWidth,
          this.imageDisplayHeight
        );

        resolve(canvas.toDataURL('image/jpeg', 0.9));
      };
    });
  }

  cancelCrop() {
    this.cropImageSrc = null;
    this.crop = { x: 0, y: 0, scale: 1 };
    this.imageNaturalWidth = 0;
    this.imageNaturalHeight = 0;
    this.imageDisplayWidth = 0;
    this.imageDisplayHeight = 0;
  }

  async removeProfilePicture() {
    const currentUser = await firstValueFrom(this.authService.user$);
    if (!currentUser) throw new Error('Not authenticated');

    // Clear Firestore profilePicture field
    const userRef = doc(this.firestore, `users/${currentUser.uid}`);
    await setDoc(userRef, { profilePicture: '', updatedAt: serverTimestamp() }, { merge: true });

    // Update the local form and reset crop modal
    this.profileForm.patchValue({ profilePicture: '' });
    this.cropImageSrc = null;
    this.showRemoveConfirm = false;
  }

  confirmRemoveProfilePicture() {
    this.cropImageSrc = null;
    this.showRemoveConfirm = true;
  }

  cancelRemoveProfilePicture() {
    this.showRemoveConfirm = false;
  }

  // Shared avatar helpers
  getInitial = getInitial;
  getAvatarColor = getAvatarColor;

  enterEditMode() {
    this.editMode = true;
    
    this.profileForm.patchValue({
      displayName: this.originalProfile.displayName,
      username: this.originalProfile.username,
      bio: this.originalProfile.bio,
      profilePicture: this.originalProfile.profilePicture || ''
    }, { emitEvent: false });
  }

  cancelEditProfile() {
    this.editMode = false;
    this.checkingUsername = false;

    this.profileForm.patchValue({
      displayName: this.originalProfile.displayName,
      username: this.originalProfile.username,
      bio: this.originalProfile.bio
    }, { emitEvent: false });
  }

  hasChanges(): boolean {
    if (!this.originalProfile) return false;

    const v = this.profileForm.value;
    return (
      v.displayName?.trim() !== this.originalProfile.displayName ||
      v.username?.trim() !== this.originalProfile.username ||
      v.bio?.trim() !== this.originalProfile.bio
    );
  }

  get canSave(): boolean {
    if (!this.originalProfile) return false;

    const trimmed = this.profileForm.value.username?.trim().toLowerCase();
    const original = this.originalProfile.username?.trim().toLowerCase();

    const usernameChanged = trimmed !== original;

    return (
      this.hasChanges() &&
      this.profileForm.valid &&
      !this.isSaving &&
      !this.checkingUsername &&
      (
        // If username didn't change → fine
        !usernameChanged ||

        // If changed → must explicitly be available
        this.currentUsernameStatus === 'available'
      )
    );
  }

  async saveEditProfile() {
    const currentUser = await firstValueFrom(this.authService.user$);
    if (!currentUser) throw new Error('Not authenticated');

    if (!this.hasChanges()) return;

    this.isSaving = true;

    const v = this.profileForm.value;

    const username = v.username?.trim().toLowerCase();

    // Validate format
    const validationError = this.authService.validateUsername(username!);
    if (validationError) {
      alert(validationError);
      return;
    }

    // Check uniqueness ONLY if changed
    if (username !== this.originalProfile.username) {
      const isUnique = await this.authService.isUsernameUnique(username!);
      if (!isUnique) {
        alert('Username is already taken');
        return;
      }
    }

    try {
      const updatedData: any = {
        updatedAt: serverTimestamp()
      };

      if (v.displayName?.trim() !== this.originalProfile.displayName) {
        updatedData.displayName = v.displayName!.trim();
      }

      if (v.username !== this.originalProfile.username) {
        updatedData.username = v.username!.toLowerCase();
      }

      if (v.bio !== this.originalProfile.bio) {
        updatedData.bio = v.bio;
      }

      const userRef = doc(this.firestore, `users/${currentUser.uid}`);
      await setDoc(userRef, updatedData, { merge: true });

      this.originalProfile = {
        ...this.originalProfile,
        ...updatedData
      };

      this.editMode = false;
    } finally {
      this.isSaving = false;
    }
  }

  openCreateModal() {
    this.showCreateModal = true;
  }

  closeCreateModal() {
    this.showCreateModal = false;
  }

  openPostModal(post: Post) {
    this.selectedPost = post;
  }

  closePostModal() {
    this.selectedPost = null;
  }

  trackByPostId(index: number, post: Post) {
    return post.id;
  }

  getFormattedCaption(post: { caption?: string }): string {
    if (!post?.caption) return '';

    // Normalize Windows newlines
    const normalized = post.caption.replace(/\r\n/g, '\n');

    // Remove leading whitespace and convert newlines to <br>
    return normalized
      .replace(/^[\s\u00A0]+/, '') // remove leading spaces
      .replace(/\n/g, '<br>');
  }

  async toggleFollow() {
    const authUser = await firstValueFrom(this.authService.user$);
    const targetUser = this.originalProfile;
    if (!authUser || !targetUser) return;

    if (this.following) {
      await this.followService.unfollowUser(authUser.uid, targetUser.uid);
      this.following = false;
    } else {
      await this.followService.followUser(authUser.uid, targetUser.uid);
      this.following = true;
    }
  }

  async openMessageThread() {
    const currentUser = await firstValueFrom(this.authService.user$);
    const targetUser = this.originalProfile;
    if (!currentUser || !targetUser) return;

    // Get or create thread
    const threadId = await this.messagesService.getOrCreateThread(targetUser.uid);

    // Navigate to messages and select the thread
    this.router.navigate(['/messages'], { queryParams: { threadId } });
  }
}
