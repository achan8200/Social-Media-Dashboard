import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, inject } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Firestore, collection, query, where, getDocs, doc, serverTimestamp, setDoc, docData } from '@angular/fire/firestore';
import { ActivatedRoute } from '@angular/router';
import { Observable, map, from, combineLatest, switchMap, of, debounceTime, distinctUntilChanged, shareReplay, tap, finalize } from 'rxjs';
import { AuthService } from '../../services/auth.service';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

type UsernameStatus =
  | 'available'
  | 'invalid'
  | 'taken'
  | null;

@Component({
  selector: 'app-profile',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './profile.html',
  styleUrl: './profile.css'
})
export class Profile {
  private firestore = inject(Firestore);
  private fb = inject(FormBuilder);
  private authService = inject(AuthService);
  private cdr = inject(ChangeDetectorRef);
  private route = inject(ActivatedRoute);

  profile$!: Observable<any>;
  isOwner$!: Observable<boolean>;

  editMode = false;
  originalProfile: any = null;
  hasChanges$!: Observable<boolean>;

  usernameStatus$!: Observable<UsernameStatus>;
  checkingUsername = false;
  isSaving = false;

  profileForm = this.fb.group({
    displayName: ['', Validators.required],
    username: ['', Validators.required],
    bio: [''],
    profilePicture: ['']
  });

   // Crop state
  cropImageSrc: string | null = null;
  cropX = 0;
  cropY = 0;
  cropScale = 1;

  private isDragging = false;
  private lastMouseX = 0;
  private lastMouseY = 0;

  // Touch pinch state
  private isPinching = false;
  private initialPinchDistance = 0;
  private initialScale = 1;

  constructor() {
    this.loadProfileFromRoute();
    this.usernameStatus$ = this.profileForm.get('username')!
    .valueChanges
    .pipe(
      map(value => value?.trim().toLowerCase() ?? ''),
      debounceTime(400),
      distinctUntilChanged(),
      switchMap(trimmed => {
        if (!this.editMode || !this.originalProfile) {
          this.cdr.detectChanges();
          this.checkingUsername = false;
          return of(null);
        }

        this.checkingUsername = true;
        this.cdr.detectChanges();

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

    // Optional but VERY useful while debugging
    this.isOwner$.subscribe(isOwner => {
      console.log('[PROFILE] isOwner =', isOwner);
    });

    this.profile$.subscribe(p => {
      console.log('[PROFILE STREAM]', p);
    });
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
      this.cropImageSrc = reader.result as string;
      this.cropX = 0;
      this.cropY = 0;
      this.cropScale = 1;
      input.value = '';
      this.cdr.detectChanges();
    };
    reader.readAsDataURL(file);
  }

  // Drag and zoom handlers
  startDrag(event: MouseEvent | TouchEvent) {
    if (event instanceof TouchEvent && event.touches.length === 2) {
      // Pinch start
      this.isPinching = true;
      const dx = event.touches[0].clientX - event.touches[1].clientX;
      const dy = event.touches[0].clientY - event.touches[1].clientY;
      this.initialPinchDistance = Math.sqrt(dx * dx + dy * dy);
      this.initialScale = this.cropScale;
      return;
    }

    this.isDragging = true;
    if (event instanceof MouseEvent) {
      this.lastMouseX = event.clientX;
      this.lastMouseY = event.clientY;
    } else {
      this.lastMouseX = event.touches[0].clientX;
      this.lastMouseY = event.touches[0].clientY;
    }
  }


  drag(event: MouseEvent | TouchEvent) {
    if (this.isPinching && event instanceof TouchEvent && event.touches.length === 2) {
      // Pinch-to-zoom
      const dx = event.touches[0].clientX - event.touches[1].clientX;
      const dy = event.touches[0].clientY - event.touches[1].clientY;
      const distance = Math.sqrt(dx * dx + dy * dy);
      const scaleChange = distance / this.initialPinchDistance;
      this.cropScale = Math.max(0.5, Math.min(3, this.initialScale * scaleChange));
      return;
    }

    if (!this.isDragging) return;

    let clientX = 0;
    let clientY = 0;
    if (event instanceof MouseEvent) {
      clientX = event.clientX;
      clientY = event.clientY;
    } else {
      clientX = event.touches[0].clientX;
      clientY = event.touches[0].clientY;
    }

    this.cropX += clientX - this.lastMouseX;
    this.cropY += clientY - this.lastMouseY;

    this.lastMouseX = clientX;
    this.lastMouseY = clientY;
  }

  endDrag() {
    this.isDragging = false;
    this.isPinching = false;
  }

  zoom(delta: number) {
    this.cropScale = Math.max(0.5, Math.min(3, this.cropScale + delta));
  }

  // Save cropped image
  async saveCroppedProfilePicture() {
    const currentUser = await this.authService.getCurrentUser().toPromise();
    if (!currentUser || !this.cropImageSrc) return;

    const croppedBase64 = await this.cropAndResize(
      this.cropImageSrc,
      256,
      this.cropX,
      this.cropY,
      this.cropScale
    );

    // Save to Firestore
    const userRef = doc(this.firestore, `users/${currentUser.uid}`);
    await setDoc(userRef, { profilePicture: croppedBase64 }, { merge: true });

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

        const dx = offsetX + img.width / 2 - size / 2;
        const dy = offsetY + img.height / 2 - size / 2;

        ctx.drawImage(img, -dx, -dy, img.width * scale, img.height * scale);

        resolve(canvas.toDataURL('image/jpeg'));
      };
    });
  }

  async removeProfilePicture() {
    const currentUser = await this.authService.getCurrentUser().toPromise();
    if (!currentUser) return;

    // Clear Firestore profilePicture field
    const userRef = doc(this.firestore, `users/${currentUser.uid}`);
    await setDoc(userRef, { profilePicture: '' }, { merge: true });

    // Update the local form and reset crop modal
    this.profileForm.patchValue({ profilePicture: '' });
    this.cropImageSrc = null;

    console.log('Profile picture removed');
  }

  // Avatar helpers
  getInitial(username?: string | null): string {
    if (!username) return '?';
    return username.charAt(0).toUpperCase();
  }

  getAvatarColor(username?: string | null): string {
    if (!username) return '#9CA3AF'; // gray-400 fallback

    let hash = 0;
    for (let i = 0; i < username.length; i++) {
      hash = username.charCodeAt(i) + ((hash << 5) - hash);
    }

    const colors = [
      '#EF4444', // red
      '#F97316', // orange
      '#EAB308', // yellow
      '#22C55E', // green
      '#06B6D4', // cyan
      '#3B82F6', // blue
      '#6366F1', // indigo
      '#A855F7', // purple
      '#EC4899'  // pink
    ];

    return colors[Math.abs(hash) % colors.length];
  }

  enterEditMode() {
    this.editMode = true;
    
    this.profileForm.patchValue({
      displayName: this.originalProfile.displayName,
      username: this.originalProfile.username,
      bio: this.originalProfile.bio
    }, { emitEvent: false });
  }

  cancelEditProfile() {
    this.editMode = false;

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
    return (
      this.hasChanges() &&
      this.profileForm.valid &&
      !this.isSaving
    );
  }

  async saveEditProfile() {
    const currentUser = await this.authService.getCurrentUser().toPromise();
    if (!currentUser) return;

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
}
