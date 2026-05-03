import { ComponentFixture, TestBed } from '@angular/core/testing';

import { SettingsAppearance } from './settings-appearance';

describe('SettingsAppearance', () => {
  let component: SettingsAppearance;
  let fixture: ComponentFixture<SettingsAppearance>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SettingsAppearance]
    })
    .compileComponents();

    fixture = TestBed.createComponent(SettingsAppearance);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
