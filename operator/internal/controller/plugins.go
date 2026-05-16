package controller

import (
	"fmt"

	corev1 "k8s.io/api/core/v1"
)

// PluginSpec mirrors Kryton.spec.plugins[].
type PluginSpec struct {
	Name   string
	URL    string
	SHA256 string
}

// PluginInitContainer renders an init-container that downloads every plugin,
// verifies sha256, and writes it into /plugins. The init-container is
// merged into the kryton Pod by patching the helm release's Deployment.
//
// The container image must contain `curl` and `sha256sum`.
func PluginInitContainer(plugins []PluginSpec, pluginsVolumeMount string) *corev1.Container {
	if len(plugins) == 0 {
		return nil
	}
	var script string
	script = "set -euo pipefail\nmkdir -p \"$DEST\"\n"
	for _, p := range plugins {
		script += fmt.Sprintf(
			"echo 'fetching %s'\n"+
				"curl -fsSL --retry 3 -o \"$DEST/%s.tmp\" %q\n"+
				"echo %q' '\"$DEST/%s.tmp\" | sha256sum -c -\n"+
				"mv \"$DEST/%s.tmp\" \"$DEST/%s\"\n",
			p.Name, p.Name, p.URL, p.SHA256, p.Name, p.Name, p.Name,
		)
	}

	return &corev1.Container{
		Name:    "plugin-installer",
		Image:   "curlimages/curl:8.10.1",
		Command: []string{"/bin/sh", "-c", script},
		Env: []corev1.EnvVar{
			{Name: "DEST", Value: "/plugins"},
		},
		VolumeMounts: []corev1.VolumeMount{
			{Name: pluginsVolumeMount, MountPath: "/plugins"},
		},
	}
}
