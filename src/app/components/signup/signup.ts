import { Component } from '@angular/core';
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

  private usernameCheckTimeout: any = null;

  showPassword = false;
  emailChecking = false;

  passwordStrength = {
    length: false,
    uppercase: false,
    lowercase: false,
    number: false,
    special: false
  };

  constructor(private authService: AuthService, private router: Router) {}

  get isFormValid(): boolean {
    return (
      !!this.email &&
      this.emailError === null &&
      !!this.username &&
      this.usernameError === null &&
      !!this.displayName &&
      this.displayNameError === null &&
      !!this.password &&
      this.passwordError === null &&
      !!this.confirmPassword &&
      this.confirmPasswordError === null
    );
  }

  async validateEmail(onBlur = false) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (!this.email) {
      this.emailError = null;
      return;
    }

    if (!emailRegex.test(this.email)) {
      this.emailError = 'Invalid email address';
      return;
    }

    if (!onBlur) return;

    this.emailChecking = true;

    try {
      await this.authService.checkEmailExists(this.email);
      this.emailError = null;
    } catch (err: any) {
      if (err.code === 'auth/email-already-in-use') {
        this.emailError = 'Email already in use';
      }
    } finally {
      this.emailChecking = false;
    }
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
    // Format validation
    const lowerUsername = this.username.toLowerCase();

    // Clear error if empty
    if (!lowerUsername) {
      this.usernameError = null;
      return;
    }

    // Synchronous format check
    const usernameFormatError = this.authService.validateUsername(lowerUsername);
    if (usernameFormatError) {
      this.usernameError = usernameFormatError;
      return;
    }

    this.usernameError = null;

    // Debounce Firestore check
    if (this.usernameCheckTimeout) clearTimeout(this.usernameCheckTimeout);
    this.usernameCheckTimeout = setTimeout(async () => {
      const unique = await this.authService.isUsernameUnique(lowerUsername);
      this.usernameError = unique ? null : 'Username already exists';
    }, 500) // wait 500ms after last keystroke
  }

  // Called when user types in the displayName input
  validateDisplayName() {
    const trimmed = this.displayName.trim();
    this.displayNameError = trimmed ? null : 'Display name cannot be empty';
  }

  async signup() {
    this.error = '';

    // Run synchronous validations
    await this.validateEmail(true);
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
      this.error = err.message || 'Signup failed';
    }
  }

  togglePasswordVisibility() {
    this.showPassword = !this.showPassword;
  }
}