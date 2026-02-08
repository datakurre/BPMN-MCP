{ ... }:
let
  shell = { ... }: {
    languages.javascript.enable = true;
    languages.javascript.npm.enable = true;
  };
in
{
  profiles.shell.module = {
    imports = [ shell ];
  };
  profiles.devcontainer.module = {
    devcontainer.enable = true;
  };
}
