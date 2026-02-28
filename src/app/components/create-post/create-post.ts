import { Component, EventEmitter, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-create-post',
  imports: [CommonModule, FormsModule],
  templateUrl: './create-post.html',
  styleUrls: ['./create-post.css']
})
export class CreatePost {
  caption: string = '';
  selectedMedia: File[] = [];

  @Output() close = new EventEmitter<void>();
  @Output() create = new EventEmitter<{ caption: string; media: File[] }>();

  onCreate() {
    if (this.caption.trim() || this.selectedMedia.length > 0) {
      this.create.emit({ caption: this.caption, media: this.selectedMedia });
      this.caption = '';
      this.selectedMedia = [];
      this.close.emit();
    }
  }

  onFileChange(event: any) {
    const files = event.target.files;
    if (files && files.length) {
      this.selectedMedia = Array.from(files);
    }
  }
}
