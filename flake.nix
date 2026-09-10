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
        nodeModules = pkgs.stdenvNoCC.mkDerivation {
          pname = "valueflow-node-modules";
          inherit version src;
          nativeBuildInputs = [ bun ];
          dontConfigure = true;
          dontFixup = true;
          buildPhase = ''
            export HOME=$TMPDIR
            export BUN_INSTALL_CACHE_DIR=$TMPDIR/bun-cache
            bun install --frozen-lockfile --ignore-scripts --no-progress --os='*' --cpu='*'
          '';
          installPhase = ''
            mkdir -p $out
            cp -R node_modules $out/node_modules
          '';
          outputHashMode = "recursive";
          outputHashAlgo = "sha256";
          outputHash = lib.fakeHash;
        };

        withDeps = ''
          export HOME=$TMPDIR
          cp -R ${nodeModules}/node_modules node_modules
          chmod -R u+w node_modules
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
            echo "  bun run dev     start the server with HMR on http://localhost:3000"
            echo "  bun run check   typecheck + lint + tests"
            echo "  bun run build   production bundle → packages/web/dist"
          '';
        };

        formatter = pkgs.nixpkgs-fmt;
      });
}
