import { ComponentFixture, TestBed } from '@angular/core/testing';

import { EditPostModal } from './edit-post-modal';

describe('EditPostModal', () => {
  let component: EditPostModal;
  let fixture: ComponentFixture<EditPostModal>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [EditPostModal]
    })
    .compileComponents();

    fixture = TestBed.createComponent(EditPostModal);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
