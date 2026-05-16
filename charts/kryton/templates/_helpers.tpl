{{/*
Expand the name of the chart.
*/}}
{{- define "kryton.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{/*
Create a default fully qualified app name.
*/}}
{{- define "kryton.fullname" -}}
{{- if .Values.fullnameOverride -}}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- $name := default .Chart.Name .Values.nameOverride -}}
{{- if contains $name .Release.Name -}}
{{- .Release.Name | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" -}}
{{- end -}}
{{- end -}}
{{- end -}}

{{/*
Chart label string.
*/}}
{{- define "kryton.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{/*
Common labels.
*/}}
{{- define "kryton.labels" -}}
helm.sh/chart: {{ include "kryton.chart" . }}
{{ include "kryton.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.kubernetes.io/part-of: kryton
{{- end -}}

{{/*
Selector labels.
*/}}
{{- define "kryton.selectorLabels" -}}
app.kubernetes.io/name: {{ include "kryton.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}

{{/*
ServiceAccount name.
*/}}
{{- define "kryton.serviceAccountName" -}}
{{- if .Values.serviceAccount.create -}}
{{- default (include "kryton.fullname" .) .Values.serviceAccount.name -}}
{{- else -}}
{{- default "default" .Values.serviceAccount.name -}}
{{- end -}}
{{- end -}}

{{/*
Image reference. Falls back to Chart.AppVersion when .Values.image.tag is empty.
*/}}
{{- define "kryton.image" -}}
{{- $tag := default .Chart.AppVersion .Values.image.tag -}}
{{- printf "%s:%s" .Values.image.repository $tag -}}
{{- end -}}

{{/*
ConfigMap and Secret names.
*/}}
{{- define "kryton.configMapName" -}}
{{ include "kryton.fullname" . }}-config
{{- end -}}

{{- define "kryton.secretName" -}}
{{ include "kryton.fullname" . }}-secret
{{- end -}}

{{/*
PVC name (supports persistence.existingClaim).
*/}}
{{- define "kryton.pvcName" -}}
{{- if .Values.persistence.existingClaim -}}
{{- .Values.persistence.existingClaim -}}
{{- else -}}
{{ include "kryton.fullname" . }}-data
{{- end -}}
{{- end -}}
