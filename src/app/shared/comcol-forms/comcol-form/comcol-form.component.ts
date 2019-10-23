import { Component, EventEmitter, Input, OnDestroy, OnInit, Output, ViewChild } from '@angular/core';
import { Location } from '@angular/common';
import { DynamicFormService, DynamicInputModel } from '@ng-dynamic-forms/core';
import { FormGroup } from '@angular/forms';
import { DynamicFormControlModel } from '@ng-dynamic-forms/core/src/model/dynamic-form-control.model';
import { TranslateService } from '@ngx-translate/core';
import { DSpaceObject } from '../../../core/shared/dspace-object.model';
import { MetadataMap, MetadataValue } from '../../../core/shared/metadata.models';
import { ResourceType } from '../../../core/shared/resource-type';
import { hasValue, isNotEmpty } from '../../empty.util';
import { UploaderOptions } from '../../uploader/uploader-options.model';
import { NotificationsService } from '../../notifications/notifications.service';
import { ComColDataService } from '../../../core/data/comcol-data.service';
import { Subscription } from 'rxjs/internal/Subscription';
import { AuthService } from '../../../core/auth/auth.service';
import { Community } from '../../../core/shared/community.model';
import { Collection } from '../../../core/shared/collection.model';
import { UploaderComponent } from '../../uploader/uploader.component';
import { FileUploader } from 'ng2-file-upload';
import { ErrorResponse, RestResponse } from '../../../core/cache/response.models';
import { BehaviorSubject } from 'rxjs/internal/BehaviorSubject';
import { RemoteData } from '../../../core/data/remote-data';
import { Bitstream } from '../../../core/shared/bitstream.model';
import { combineLatest as observableCombineLatest } from 'rxjs';
import { RestRequestMethod } from '../../../core/data/rest-request-method';
import { RequestService } from '../../../core/data/request.service';
import { ObjectCacheService } from '../../../core/cache/object-cache.service';
import { take } from 'rxjs/operators';

/**
 * A form for creating and editing Communities or Collections
 */
@Component({
  selector: 'ds-comcol-form',
  styleUrls: ['./comcol-form.component.scss'],
  templateUrl: './comcol-form.component.html'
})
export class ComColFormComponent<T extends DSpaceObject> implements OnInit, OnDestroy {

  /**
   * The logo uploader component
   */
  @ViewChild(UploaderComponent) uploaderComponent: UploaderComponent;

  /**
   * DSpaceObject that the form represents
   */
  @Input() dso: T;

  /**
   * Type of DSpaceObject that the form represents
   */
  type: ResourceType;

  /**
   * @type {string} Key prefix used to generate form labels
   */
  LABEL_KEY_PREFIX = '.form.';

  /**
   * @type {string} Key prefix used to generate form error messages
   */
  ERROR_KEY_PREFIX = '.form.errors.';

  /**
   * The form model that represents the fields in the form
   */
  formModel: DynamicFormControlModel[];

  /**
   * The form group of this form
   */
  formGroup: FormGroup;

  /**
   * The uploader configuration options
   * @type {UploaderOptions}
   */
  uploadFilesOptions: UploaderOptions = Object.assign(new UploaderOptions(), {
    autoUpload: false
  });

  /**
   * Emits DSO and Uploader when the form is submitted
   */
  @Output() submitForm: EventEmitter<{
    dso: T,
    uploader: FileUploader
  }> = new EventEmitter();

  /**
   * Fires an event when the logo has finished uploading (with or without errors)
   */
  @Output() finishUpload: EventEmitter<any> = new EventEmitter();

  /**
   * Observable keeping track whether or not the uploader has finished initializing
   * Used to start rendering the uploader component
   */
  initializedUploaderOptions = new BehaviorSubject(false);

  /**
   * Array to track all subscriptions and unsubscribe them onDestroy
   * @type {Array}
   */
  protected subs: Subscription[] = [];

  /**
   * The service used to fetch from or send data to
   */
  protected dsoService: ComColDataService<Community | Collection>;

  public constructor(protected location: Location,
                     protected formService: DynamicFormService,
                     protected translate: TranslateService,
                     protected notificationsService: NotificationsService,
                     protected authService: AuthService,
                     protected requestService: RequestService,
                     protected objectCache: ObjectCacheService) {
  }

  ngOnInit(): void {
    this.formModel.forEach(
      (fieldModel: DynamicInputModel) => {
        fieldModel.value = this.dso.firstMetadataValue(fieldModel.name);
      }
    );
    this.formGroup = this.formService.createFormGroup(this.formModel);

    this.updateFieldTranslations();
    this.translate.onLangChange
      .subscribe(() => {
        this.updateFieldTranslations();
      });

    if (hasValue(this.dso.id)) {
      this.subs.push(
        observableCombineLatest(
          this.dsoService.getLogoEndpoint(this.dso.id),
          (this.dso as any).logo
        ).subscribe(([href, logoRD]: [string, RemoteData<Bitstream>]) => {
          this.uploadFilesOptions.url = href;
          this.uploadFilesOptions.authToken = this.authService.buildAuthHeader();
          // If the object already contains a logo, send out a PUT request instead of POST for setting a new logo
          if (hasValue(logoRD.payload)) {
            this.uploadFilesOptions.method = RestRequestMethod.PUT;
          }
          this.initializedUploaderOptions.next(true);
        })
      );
    } else {
      // Set a placeholder URL to not break the uploader component. This will be replaced once the object is created.
      this.uploadFilesOptions.url = 'placeholder';
      this.uploadFilesOptions.authToken = this.authService.buildAuthHeader();
      this.initializedUploaderOptions.next(true);
    }
  }

  /**
   * Checks which new fields were added and sends the updated version of the DSO to the parent component
   */
  onSubmit() {
    const formMetadata = new Object() as MetadataMap;
    this.formModel.forEach((fieldModel: DynamicInputModel) => {
      const value: MetadataValue = {
          value: fieldModel.value as string,
          language: null
        } as any;
      if (formMetadata.hasOwnProperty(fieldModel.name)) {
        formMetadata[fieldModel.name].push(value);
      } else {
        formMetadata[fieldModel.name] = [value];
      }
    });

    const updatedDSO = Object.assign({}, this.dso, {
      metadata: {
        ...this.dso.metadata,
        ...formMetadata
      },
      type: Community.type
    });
    this.submitForm.emit({
      dso: updatedDSO,
      uploader: hasValue(this.uploaderComponent) ? this.uploaderComponent.uploader : undefined
    });
  }

  /**
   * Used the update translations of errors and labels on init and on language change
   */
  private updateFieldTranslations() {
    this.formModel.forEach(
      (fieldModel: DynamicInputModel) => {
        fieldModel.label = this.translate.instant(this.type.value + this.LABEL_KEY_PREFIX + fieldModel.id);
        if (isNotEmpty(fieldModel.validators)) {
          fieldModel.errorMessages = {};
          Object.keys(fieldModel.validators).forEach((key) => {
            fieldModel.errorMessages[key] = this.translate.instant(this.type.value + this.ERROR_KEY_PREFIX + fieldModel.id + '.' + key);
          });
        }
      }
    );
  }

  /**
   * Send out a delete request to remove the logo from the community/collection and display notifications
   */
  deleteLogo() {
    if (hasValue(this.dso.id)) {
      this.dsoService.deleteLogo(this.dso).subscribe((response: RestResponse) => {
        if (response.isSuccessful) {
          this.notificationsService.success(
            this.translate.get(this.type.value + '.edit.logo.notifications.delete.success.title'),
            this.translate.get(this.type.value + '.edit.logo.notifications.delete.success.content')
          );
        } else {
          const errorResponse = response as ErrorResponse;
          this.notificationsService.error(
            this.translate.get(this.type.value + '.edit.logo.notifications.delete.error.title'),
            errorResponse.errorMessage
          );
        }
        (this.dso as any).logo = undefined;
      });
    }
  }

  /**
   * Refresh the object's cache to ensure the latest version
   */
  private refreshCache() {
    this.requestService.removeByHrefSubstring(this.dso.self);
    this.objectCache.remove(this.dso.self);
  }

  /**
   * The request was successful, display a success notification
   */
  public onCompleteItem() {
    this.refreshCache();
    this.notificationsService.success(null, this.translate.get(this.type.value + '.edit.logo.notifications.add.success'));
    this.finishUpload.emit();
  }

  /**
   * The request was unsuccessful, display an error notification
   */
  public onUploadError() {
    this.notificationsService.error(null, this.translate.get(this.type.value + '.edit.logo.notifications.add.error'));
    this.finishUpload.emit();
  }

  /**
   * Cancel the form and return to the previous page
   */
  onCancel() {
    this.location.back();
  }

  /**
   * Unsubscribe from open subscriptions
   */
  ngOnDestroy(): void {
    this.subs
      .filter((subscription) => hasValue(subscription))
      .forEach((subscription) => subscription.unsubscribe());
  }
}
