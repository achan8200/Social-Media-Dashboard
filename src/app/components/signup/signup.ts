import { ChangeDetectorRef, Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-signup',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './signup.html',
  styleUrls: ['./signup.css']
})
export class Signup {
  email = '';
  password = '';
  confirmPassword = '';
  username = '';
  displayName = '';
  error = '';

  emailError: string | null = null;
  passwordError: string | null = null;
  confirmPasswordError: string | null = null;
  usernameError: string | null = null;
  displayNameError: string | null = null;

  usernameValid = false;
  usernameChecking = false;
  private usernameCheckTimeout: any = null;
  private usernameValidationId = 0; // for race condition safety

  showPassword = false;

  passwordStrength = {
    length: false,
    uppercase: false,
    lowercase: false,
    number: false,
    special: false
  };

  constructor(private authService: AuthService, private router: Router, private cdr: ChangeDetectorRef) {}

  get isFormValid(): boolean {
    return (
      !!this.email &&
      this.emailError === null &&
      !!this.username &&
      this.usernameError === null &&
      this.usernameValid &&
      !!this.displayName &&
      this.displayNameError === null &&
      !!this.password &&
      this.passwordError === null &&
      !!this.confirmPassword &&
      this.confirmPasswordError === null
    );
  }

  validateEmail() {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (!this.email) {
      this.emailError = null;
      return;
    }

    if (!emailRegex.test(this.email)) {
      this.emailError = 'Invalid email address';
      return;
    }

    this.emailError = null;
  }

  validatePassword() {
    const password = this.password;

    // Reset strength flags
    this.passwordStrength = {
      length: password.length >= 8,
      uppercase: /[A-Z]/.test(password),
      lowercase: /[a-z]/.test(password),
      number: /[0-9]/.test(password),
      special: /[^A-Za-z0-9]/.test(password)
    };

    const allValid = Object.values(this.passwordStrength).every(Boolean);

    if (!password) {
      this.passwordError = null;
      return;
    }

    if (!allValid) {
      this.passwordError = 'Password does not meet all requirements';
      return;
    }

    // Strong password -> clear error
    this.passwordError = null;

    this.validateConfirmPassword();
  }

  validateConfirmPassword() {
    if (!this.confirmPassword) {
      this.confirmPasswordError = null;
      return;
    }

    this.confirmPasswordError =
      this.password && this.password === this.confirmPassword
        ? null
        : 'Passwords do not match';
  }

  // Called when user types in the username input
  async validateUsername() {
    const lowerUsername = this.username.trim().toLowerCase();

    // Clear error and reset validity if empty
    if (!lowerUsername) {
      this.usernameError = null;
      this.usernameValid = false;
      this.usernameChecking = false;

      // Cancel any pending debounce
      if (this.usernameCheckTimeout) {
        clearTimeout(this.usernameCheckTimeout);
        this.usernameCheckTimeout = null;
      }

      this.cdr.markForCheck();
      return;
    }

    // Synchronous format check
    const usernameFormatError = this.authService.validateUsername(lowerUsername);
    if (usernameFormatError) {
      this.usernameError = usernameFormatError;
      this.usernameValid = false;
      this.usernameChecking = false;

      if (this.usernameCheckTimeout) {
        clearTimeout(this.usernameCheckTimeout);
        this.usernameCheckTimeout = null;
      }
      
      this.cdr.markForCheck();
      return;
    }

    // Passed format check
    this.usernameError = null;
    this.usernameValid = false;

    // Show spinner immediately
    this.usernameChecking = true;
    this.cdr.markForCheck();

    // Cancel previous debounce
    if (this.usernameCheckTimeout) clearTimeout(this.usernameCheckTimeout);

    // Increment validationId to prevent race conditions
    const validationId = ++this.usernameValidationId;

    // Debounce Firestore uniqueness check
    this.usernameCheckTimeout = setTimeout(async () => {
      // Stop immediately if input is now empty
      const currentValue = this.username.trim().toLowerCase();
      if (!currentValue) {
        this.usernameChecking = false;
        this.usernameValid = false;
        this.usernameError = null;
        this.cdr.markForCheck();
        return;
      }
      
      try {
        const isUnique = await this.authService.isUsernameUnique(lowerUsername);

        // Prevent race condition
        if (validationId !== this.usernameValidationId) return;

        if (isUnique) {
          this.usernameError = null;
          this.usernameValid = true;
        } else {
          this.usernameError = 'Username already exists';
          this.usernameValid = false;
        }
      } finally {
        if (validationId === this.usernameValidationId) {
          this.usernameChecking = false; // stop spinner
          this.cdr.markForCheck();
        }
      }
    }, 400); // wait 400ms after last keystroke
  }

  // Called when user types in the displayName input
  validateDisplayName() {
    const trimmed = this.displayName.trim();
    if (!this.displayName) {
      this.displayNameError = null;
      return;
    }
    this.displayNameError = trimmed ? null : 'Display name cannot be empty';
  }

  async signup() {
    this.error = '';

    // Run synchronous validations
    this.email = this.email.trim();
    this.validateEmail();
    this.validatePassword();
    this.validateConfirmPassword();
    this.validateDisplayName();

    // Username format check (sync)
    const usernameFormatError = this.authService.validateUsername(
      this.username.trim().toLowerCase()
    );
    this.usernameError = usernameFormatError;

    if (
      this.emailError ||
      this.passwordError ||
      this.confirmPasswordError ||
      this.displayNameError ||
      this.usernameError
    ) {
      return;
    }

    // Force username uniqueness check (NO debounce)
    const isUnique = await this.authService.isUsernameUnique(
      this.username.trim().toLowerCase()
    );

    if (!isUnique) {
      this.usernameError = 'Username already exists';
      return;
    }

    try {
      await this.authService.signup(
        this.email.trim(),
        this.password,
        this.username.trim().toLowerCase(),
        this.displayName.trim()
      );

      this.router.navigate(['/home'], { replaceUrl: true });
    } catch (err: any) {
      if (err.code === 'auth/email-already-in-use') {
        this.emailError = 'Email already in use';
      } else {
        this.error = err.message || 'Signup failed';
      }
    }
  }

  togglePasswordVisibility() {
    this.showPassword = !this.showPassword;
  }
}