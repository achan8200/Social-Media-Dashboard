import { ComponentFixture, TestBed } from '@angular/core/testing';

import { SettingsProfile } from './settings-profile';

describe('SettingsProfile', () => {
  let component: SettingsProfile;
  let fixture: ComponentFixture<SettingsProfile>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SettingsProfile]
    })
    .compileComponents();

    fixture = TestBed.createComponent(SettingsProfile);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
