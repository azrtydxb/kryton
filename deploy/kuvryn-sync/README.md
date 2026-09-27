# Kryton on kw with Kuvryn Sync

`master:deploy/kuvryn-sync/` is the authoritative deployment configuration for
kw. Sync reconciles automatically, checks health and uses `conflictPolicy: fail`.
This adoption preserves the currently running application/operator versions.
It uses explicit manifests to avoid changing defaults during the handover.

All adopted resources carry prune protection, automatic pruning is disabled,
and deployer permissions contain no delete verbs. Application deletion orphans
resources. Deletion is an explicit maintenance operation, not removal from Git.

## Release changes

1. Edit the relevant desired files. Build and verify images before promoting
   their version/reference. Merging application code alone does not deploy it.
2. Edit encrypted configuration with `sops edit <file.sops.yaml>`. Set
   `SOPS_AGE_KEY_FILE` to the matching namespace's private age identity.
3. Render to a private file outside the repository, then validate and review
   the live diff privately; never put decrypted values in logs or Git:

   ```sh
   export SOPS_AGE_KEY_FILE="$HOME/.config/kuvryn-sync/age/kw-watteel-kryton.agekey"
   python3 deploy/kuvryn-sync/render-private.py kw /tmp/kryton-desired.yaml
   kubectl --context kw apply --server-side --dry-run=server \
     --field-manager=kuvryn-sync -f /tmp/kryton-desired.yaml
   ```

4. Commit and push the reviewed change to `master`. Sync polls every 60 seconds.
   Verify Healthy/Synced, matching desired/deployed revisions and ready child
   workloads. Revert the deployment commit to roll back configuration; an image
   rollback does not undo database migrations or data changes.

## Operator ownership

There are two Applications: `kryton-operator-system/kryton-operator` renders
`operator/`, and `watteel-kryton/kryton` renders `kw/`. Sync owns the operator
Deployment, Service, runtime permissions, CRD and parent Kryton resource.
The Kryton operator continues owning the Helm release and its child deployments,
PostgreSQL, claims, configuration and Secrets. This is the intended ownership
chain: Git → Sync → Kryton resource → operator/Helm → application resources.

Keep the operator's Helm release and history. Do not retire its release records
or run `helm uninstall`. Credential values are stored inside the parent
resource's SOPS-encrypted `spec.values`; its `spec.version` stays readable for
image promotion. The existing runtime versions are preserved:
Kryton `4.7.0-pre.2`, operator `4.6.5-pre.14`, embedded chart `4.6.5-pre.10`.
These are separate version domains, not a request to upgrade application code.

Only change operator/CRD versions through a reviewed compatibility upgrade.
Check operator readiness before changing the parent resource; the two Sync
Applications are in different namespaces and have no cross-namespace dependency
field. Verify the child deployments and PostgreSQL as well as Sync health:

```sh
kubectl --context kw -n watteel-kryton get kryton,deploy,sts,pvc
helm --kube-context kw -n watteel-kryton status kryton
```

The legacy operator Makefile blocks install/deploy/uninstall/undeploy on the
`kw` context while its Sync Application exists. Other contexts retain the
original installation workflow.

## Bootstrap and recovery

Top-level `rbac.yaml`, `repository.yaml` and `application.yaml` bootstrap the
application. Kryton additionally uses the `operator-*.yaml` definitions for its
operator Application. Bootstrap namespaces, Sync and required operator CRDs
before restoring workloads. Operator cluster permissions and its CRD are
restricted to the exact adopted names: create those names as an administrator
on a fresh cluster before Sync updates them. The deployer cannot create
arbitrary cluster roles or CRDs.

Git credentials and SOPS keys are bootstrap Secrets, outside the desired
render directories. `kuvryn-sync-sops` in the application namespace contains
`identity.agekey` and the label `sync.kuvryn.io/decryption-key: "true"`.
Recovery identities are stored locally at
`~/.config/kuvryn-sync/age/kw-<namespace>.agekey` (0600). Back them up securely;
Git alone cannot decrypt credentials. Kryton's public repository needs no Git
credential, and its operator configuration needs no decryption key.

For first adoption, privately archive live objects with managed fields,
credentials, volume/pod identities and any Helm records. Validate decrypted
manifests with both an administrator and the Sync deployer identity. Transfer
only legacy deployment ownership; retain status/operator ownership. A one-time
force apply is allowed for the reviewed handover, but regular reconciliation
keeps `conflictPolicy: fail`. Never clear ownership on operator-generated
application resources.

Kryton database and notes archives were captured before migration; their
archive listings were validated. A full restore drill was not performed.
The Git configuration itself is not a database or notes backup.
