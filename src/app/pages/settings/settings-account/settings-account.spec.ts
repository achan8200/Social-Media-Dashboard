import { ComponentFixture, TestBed } from '@angular/core/testing';

import { SettingsAccount } from './settings-account';

describe('SettingsAccount', () => {
  let component: SettingsAccount;
  let fixture: ComponentFixture<SettingsAccount>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SettingsAccount]
    })
    .compileComponents();

    fixture = TestBed.createComponent(SettingsAccount);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
