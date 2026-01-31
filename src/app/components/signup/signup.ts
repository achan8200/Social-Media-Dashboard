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
  username = '';
  displayName = '';
  error = '';

  emailError: string | null = null;
  usernameError: string | null = null;
  displayNameError: string | null = null;

  private usernameCheckTimeout: any = null;

  constructor(private authService: AuthService, private router: Router) {}

  validateEmail() {
    const trimmedEmail = this.email.trim();

    // Clear error if empty
    if (!trimmedEmail) {
      this.emailError = null;
      return;
    }

    // Simple, safe email regex
    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (!emailPattern.test(trimmedEmail)) {
      this.emailError = 'Please enter a valid email address';
      return;
    }

    // Valid email -> clear error
    this.emailError = null;
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

    // Final validation before submit
    this.validateEmail();
    this.validateUsername();
    this.validateDisplayName();

    if (this.emailError || this.usernameError || this.displayNameError) return;

    try {
      await this.authService.signup(this.email.trim(), this.password.trim(), this.username.trim().toLowerCase(), this.displayName.trim());
      this.router.navigate(['/home'], { replaceUrl: true });
    } catch (err: any) {
      this.error = err.message || 'Signup failed';
    }
  }
}