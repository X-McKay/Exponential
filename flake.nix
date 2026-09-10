{
  description = "ValueFlow — AI-project delivery platform: value tied to performance-gated milestones, release go-live criteria, and governance";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = import nixpkgs { inherit system; };
        lib = pkgs.lib;
        bun = pkgs.bun;
        version = "0.1.0";

        # Sources that affect the build; excludes node_modules, dist, data, and result links.
        src = lib.cleanSourceWith {
          src = ./.;
          filter = path: type:
            let base = baseNameOf path;
            in !(builtins.elem base [ "node_modules" "dist" "data" ".direnv" ".git" ])
               && !(lib.hasPrefix "result" base)
               && !(lib.hasSuffix ".sqlite" base);
        };

        # Dependencies as a fixed-output derivation. `--os=* --cpu=*` installs
        # optional platform binaries for every platform so the hash is the same
        # on every system. After changing bun.lock, run `nix build .#nodeModules`
        # once: the hash-mismatch error prints the value to paste below.
        # Only the manifests feed the dependency derivation, so editing source
        # files never triggers a reinstall.
        manifests = lib.fileset.toSource {
          root = ./.;
          fileset = lib.fileset.unions [
            ./package.json
            ./bun.lock
            (lib.fileset.fileFilter (f: f.name == "package.json") ./packages)
          ];
        };

        nodeModules = pkgs.stdenvNoCC.mkDerivation {
          pname = "valueflow-node-modules";
          inherit version;
          src = manifests;
          nativeBuildInputs = [ bun ];
          dontConfigure = true;
          dontFixup = true;
          buildPhase = ''
            export HOME=$TMPDIR
            export BUN_INSTALL_CACHE_DIR=$TMPDIR/bun-cache
            bun install --frozen-lockfile --ignore-scripts --no-progress --os='*' --cpu='*'
          '';
          # Bun's isolated linker stores packages under node_modules/.bun and links
          # each workspace's dependencies from packages/*/node_modules, so the
          # whole install tree is captured, not just the root directory.
          installPhase = ''
            mkdir -p $out
            cp -R node_modules $out/node_modules
            for d in packages/*/node_modules; do
              mkdir -p "$out/$(dirname "$d")"
              cp -R "$d" "$out/$d"
            done
          '';
          outputHashMode = "recursive";
          outputHashAlgo = "sha256";
          outputHash = "sha256-0rqxdaeZKYyITBYY3eMs5AWGSaRH6f6zt+EMPTV3kVw=";
        };

        withDeps = ''
          export HOME=$TMPDIR
          tar -C ${nodeModules} -cf - . | tar -xf -
          chmod -R u+w node_modules packages
        '';

        # Production bundle + server, runnable as `valueflow`.
        valueflow = pkgs.stdenvNoCC.mkDerivation {
          pname = "valueflow";
          inherit version src;
          nativeBuildInputs = [ bun pkgs.makeWrapper ];
          dontConfigure = true;
          buildPhase = ''
            ${withDeps}
            bun run build
          '';
          installPhase = ''
            app=$out/share/valueflow
            mkdir -p $app $out/bin
            cp -R package.json bun.lock tsconfig.json packages node_modules $app/
            makeWrapper ${bun}/bin/bun $out/bin/valueflow \
              --add-flags "$app/packages/server/src/index.ts" \
              --set NODE_ENV production \
              --set-default VALUEFLOW_DB "$HOME/.local/share/valueflow/valueflow.sqlite" \
              --set-default PORT 3000
          '';
          dontFixup = true;
        };

        # typecheck + lint + tests, so `nix flake check` gates CI.
        check = pkgs.stdenvNoCC.mkDerivation {
          pname = "valueflow-check";
          inherit version src;
          nativeBuildInputs = [ bun ];
          dontConfigure = true;
          buildPhase = ''
            ${withDeps}
            bun run typecheck
            bun run lint
            bun test
          '';
          installPhase = "touch $out";
          dontFixup = true;
        };
      in
      {
        packages = {
          default = valueflow;
          inherit valueflow nodeModules;
        };

        apps.default = {
          type = "app";
          program = "${valueflow}/bin/valueflow";
        };

        checks = {
          default = check;
          inherit check;
        };

        devShells.default = pkgs.mkShell {
          packages = [
            bun
            pkgs.just
            pkgs.sqlite
            pkgs.typescript-language-server
            pkgs.typescript
          ];
          shellHook = ''
            if [ ! -d node_modules ]; then
              echo "→ bun install (first run)"
              bun install --frozen-lockfile
            fi
            echo "ValueFlow dev shell — bun $(bun --version)"
            echo "  just            list tasks (just dev, just check, just build, ...)"
          '';
        };

        formatter = pkgs.nixpkgs-fmt;
      });
}
