import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AccountService } from '../../../services/account.service';
import { ConfirmModal } from '../../../components/confirm-modal/confirm-modal';

@Component({
  selector: 'app-settings-account',
  standalone: true,
  imports: [CommonModule, FormsModule, ConfirmModal],
  templateUrl: './settings-account.html',
  styleUrl: './settings-account.css'
})
export class SettingsAccount {
  password = '';
  loading = false;
  error = '';

  showDeleteModal = false;

  constructor(
    private accountService: AccountService,
    private router: Router
  ) {}

  openDeleteModal() {
    this.showDeleteModal = true;
  }

  async confirmDeleteAccount() {
    try {
      this.loading = true;
      this.error = '';

      await this.accountService.deleteAccount(this.password);

      alert('Account deleted successfully');

      // Redirect user
      await this.router.navigate(['/login']);
    }
    catch (err: any) {
      console.error(err);
      if (err.code === 'auth/invalid-credential') {
        this.error = 'Password is incorrect';
      } else {
        this.error = err.message || 'Failed deleting account';
      }
    }
    finally {
      this.loading = false;
      this.showDeleteModal = false;
    }
  }

  closeDeleteModal() {
    this.showDeleteModal = false;
  }
}