package v1alpha1

import (
	apiextensionsv1 "k8s.io/apiextensions-apiserver/pkg/apis/apiextensions/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// KrytonSpec describes the desired state of a Kryton instance.
//
// `values` is forwarded verbatim to the embedded helm chart; the other
// fields are reconciled by operator-only controllers (backup, plugins,
// snapshot). See config/crd/bases/kryton.azrtydxb.io_krytons.yaml for the
// canonical schema.
type KrytonSpec struct {
	// Version is the appVersion of the kryton server image to deploy.
	// Surfaced into helm values as image.tag.
	Version string `json:"version"`

	// Values is an opaque YAML-compatible blob passed straight through to
	// the embedded helm chart's values. Stored as a JSON object so that
	// arbitrary nested keys are preserved (x-kubernetes-preserve-unknown-fields).
	// +optional
	Values *apiextensionsv1.JSON `json:"values,omitempty"`

	// Backup configures the postgres backup CronJob.
	// +optional
	Backup *BackupSpec `json:"backup,omitempty"`

	// Plugins are pre-installed via an init-container.
	// +optional
	Plugins []Plugin `json:"plugins,omitempty"`

	// Snapshot configures the VolumeSnapshot CronJob.
	// +optional
	Snapshot *SnapshotSpec `json:"snapshot,omitempty"`
}

// BackupSpec configures the postgres backup CronJob.
type BackupSpec struct {
	// Schedule is a cron expression (UTC) for pg_dump.
	Schedule string `json:"schedule"`
	// Retention is a duration string (e.g. "30d") used by `mc rm --older-than`.
	// +optional
	Retention string `json:"retention,omitempty"`
	// ObjectStore is the S3-compatible destination. Endpoint is always explicit;
	// no AWS-specific behaviour. Works with MinIO, Garage, SeaweedFS, etc.
	// +optional
	ObjectStore *ObjectStore `json:"objectStore,omitempty"`
}

// ObjectStore is the S3-compatible target for backups.
type ObjectStore struct {
	Bucket   string `json:"bucket"`
	Endpoint string `json:"endpoint"`
	// +optional
	Region string `json:"region,omitempty"`
	// +optional
	Prefix string `json:"prefix,omitempty"`
	// CredentialsSecretRef references a Secret with keys
	// OBJECT_STORE_ACCESS_KEY and OBJECT_STORE_SECRET_KEY.
	// +optional
	CredentialsSecretRef *SecretRef `json:"credentialsSecretRef,omitempty"`
}

// SecretRef references a Secret by name in the same namespace.
type SecretRef struct {
	Name string `json:"name"`
}

// Plugin is a pre-installed plugin entry.
type Plugin struct {
	Name string `json:"name"`
	URL  string `json:"url"`
	// SHA256 is the hex-encoded SHA-256 digest of the plugin archive.
	SHA256 string `json:"sha256"`
}

// SnapshotSpec configures the VolumeSnapshot CronJob.
type SnapshotSpec struct {
	Schedule string `json:"schedule"`
	// +optional
	Retention string `json:"retention,omitempty"`
	// +optional
	VolumeSnapshotClassName string `json:"volumeSnapshotClassName,omitempty"`
}

// KrytonStatus reflects the observed state.
type KrytonStatus struct {
	// +optional
	HelmRevision int `json:"helmRevision,omitempty"`
	// +optional
	ObservedVersion string `json:"observedVersion,omitempty"`
	// +optional
	Conditions []metav1.Condition `json:"conditions,omitempty"`
}

// +kubebuilder:object:root=true
// +kubebuilder:subresource:status

// Kryton is the Schema for the krytons API.
type Kryton struct {
	metav1.TypeMeta   `json:",inline"`
	metav1.ObjectMeta `json:"metadata,omitempty"`

	Spec   KrytonSpec   `json:"spec,omitempty"`
	Status KrytonStatus `json:"status,omitempty"`
}

// +kubebuilder:object:root=true

// KrytonList contains a list of Kryton.
type KrytonList struct {
	metav1.TypeMeta `json:",inline"`
	metav1.ListMeta `json:"metadata,omitempty"`
	Items           []Kryton `json:"items"`
}
