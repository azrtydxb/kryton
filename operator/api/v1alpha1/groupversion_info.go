// Package v1alpha1 contains the Go types for the Kryton custom resource.
//
// The CRD itself is the source of truth (config/crd/bases/...). Because the
// operator was scaffolded with the helm-sdk layout (no controller-gen), the
// Go types and their DeepCopy implementations are maintained by hand and
// must be kept in sync with the OpenAPI schema in the CRD YAML.
//
// +kubebuilder:object:generate=true
// +groupName=kryton.azrtydxb.io
package v1alpha1

import (
	"k8s.io/apimachinery/pkg/runtime/schema"
	"sigs.k8s.io/controller-runtime/pkg/scheme"
)

// GroupVersion is group version used to register these objects.
var GroupVersion = schema.GroupVersion{Group: "kryton.azrtydxb.io", Version: "v1alpha1"}

// SchemeBuilder is used to add go types to the GroupVersionKind scheme.
var SchemeBuilder = &scheme.Builder{GroupVersion: GroupVersion}

// AddToScheme adds the types in this group-version to the given scheme.
var AddToScheme = SchemeBuilder.AddToScheme

func init() {
	SchemeBuilder.Register(&Kryton{}, &KrytonList{})
}
