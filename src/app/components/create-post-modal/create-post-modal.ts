import { Component, EventEmitter, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { PostsService } from '../../services/posts.service';

interface SelectedMedia {
  file: File;
  previewUrl: string;
  progress: number; // 0–100
}

@Component({
  selector: 'app-create-post-modal',
  imports: [CommonModule, FormsModule],
  templateUrl: './create-post-modal.html',
  styleUrls: ['./create-post-modal.css']
})
export class CreatePostModal {
  caption: string = '';
  selectedMedia: SelectedMedia[] = [];

  @Output() close = new EventEmitter<void>();
  @Output() create = new EventEmitter<{ caption: string; media: File[] }>();

  constructor(private postsService: PostsService) {}

  async onCreate() {
    if (!this.caption.trim() && this.selectedMedia.length === 0) return;

    const files = this.selectedMedia.map(m => m.file);

    await this.postsService.createPost(
      this.caption,
      files,
      (index, progress) => {
        this.selectedMedia[index].progress = progress;
      }
    );

    this.caption = '';
    this.selectedMedia.forEach(m => URL.revokeObjectURL(m.previewUrl));
    this.selectedMedia = [];
    this.close.emit();
  }

  onFileChange(event: Event) {
    const input = event.target as HTMLInputElement;

    if (!input.files || input.files.length === 0) return;

    const files: File[] = Array.from(input.files);

    const newFiles: SelectedMedia[] = files.map((file: File) => ({
      file,
      previewUrl: URL.createObjectURL(file),
      progress: 0
    }));

    this.selectedMedia = [...this.selectedMedia, ...newFiles];

    // Reset input so same file can be re-selected if removed
    input.value = '';
  }

  removeMedia(index: number) {
    URL.revokeObjectURL(this.selectedMedia[index].previewUrl);
    this.selectedMedia.splice(index, 1);
  }
}
