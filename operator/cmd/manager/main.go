// Command manager is the Kryton operator entrypoint.
//
// It runs two reconcilers against the same Kryton CR:
//
//  1. A helm-based reconciler (provided by helm-operator-plugins) that
//     installs/upgrades the embedded charts/kryton chart from spec.values.
//  2. A Go controller-runtime reconciler ("kryton-extras") that handles
//     the operator-only spec fields: backup, plugins, snapshot.
//
// The chart is embedded into the binary via //go:embed so the operator
// image is self-contained and need not bundle a separate chart directory.
package main

import (
	"flag"
	"fmt"
	"os"

	"k8s.io/apimachinery/pkg/runtime"
	utilruntime "k8s.io/apimachinery/pkg/util/runtime"
	clientgoscheme "k8s.io/client-go/kubernetes/scheme"
	ctrl "sigs.k8s.io/controller-runtime"
	"sigs.k8s.io/controller-runtime/pkg/healthz"
	"sigs.k8s.io/controller-runtime/pkg/log/zap"
	metricsserver "sigs.k8s.io/controller-runtime/pkg/metrics/server"

	"github.com/azrtydxb/kryton/operator/internal/chartfs"
	"github.com/azrtydxb/kryton/operator/internal/controller"
	helmreconciler "github.com/azrtydxb/kryton/operator/internal/helm"
)

var (
	scheme   = runtime.NewScheme()
	setupLog = ctrl.Log.WithName("setup")
)

func init() {
	utilruntime.Must(clientgoscheme.AddToScheme(scheme))
}

func main() {
	var metricsAddr, probeAddr string
	var enableLeaderElection bool
	flag.StringVar(&metricsAddr, "metrics-bind-address", ":8080", "Metrics bind address.")
	flag.StringVar(&probeAddr, "health-probe-bind-address", ":8081", "Health probe bind address.")
	flag.BoolVar(&enableLeaderElection, "leader-elect", false, "Enable leader election.")
	opts := zap.Options{Development: true}
	opts.BindFlags(flag.CommandLine)
	flag.Parse()

	ctrl.SetLogger(zap.New(zap.UseFlagOptions(&opts)))

	mgr, err := ctrl.NewManager(ctrl.GetConfigOrDie(), ctrl.Options{
		Scheme:                 scheme,
		Metrics:                metricsserver.Options{BindAddress: metricsAddr},
		HealthProbeBindAddress: probeAddr,
		LeaderElection:         enableLeaderElection,
		LeaderElectionID:       "kryton-operator.azrtydxb.io",
	})
	if err != nil {
		setupLog.Error(err, "unable to start manager")
		os.Exit(1)
	}

	// Bind the embedded chart FS to the helm reconciler.
	chartFS, err := chartfs.LoadEmbedded()
	if err != nil {
		setupLog.Error(err, "unable to load embedded chart")
		os.Exit(1)
	}

	if err := helmreconciler.SetupWithManager(mgr, chartFS); err != nil {
		setupLog.Error(err, "unable to set up helm reconciler")
		os.Exit(1)
	}

	if err := (&controller.KrytonExtrasReconciler{
		Client: mgr.GetClient(),
		Scheme: mgr.GetScheme(),
	}).SetupWithManager(mgr); err != nil {
		setupLog.Error(err, "unable to set up KrytonExtras controller")
		os.Exit(1)
	}

	if err := mgr.AddHealthzCheck("healthz", healthz.Ping); err != nil {
		setupLog.Error(err, "unable to set up health check")
		os.Exit(1)
	}
	if err := mgr.AddReadyzCheck("readyz", healthz.Ping); err != nil {
		setupLog.Error(err, "unable to set up ready check")
		os.Exit(1)
	}

	setupLog.Info("starting manager", "chartFiles", chartFS.FileCount())
	if err := mgr.Start(ctrl.SetupSignalHandler()); err != nil {
		setupLog.Error(err, "problem running manager")
		os.Exit(1)
	}
	_ = fmt.Sprintf
}
