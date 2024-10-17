# imports-graph

Draw dependency graph for typescript or javascript modules

## Install

Download the file (imports-graph.ts) or git clone the repo or imports from JSR

## Usage

### Output dot notation to stdio/terminal

```sh
deno run --allow-read ../imports-graph.ts ../ui/src
```

or you can pipe it to clipboard and paste it in an online
[graph viewer](https://magjac.com/graphviz-visual-editor/)

```sh
deno run --allow-read ../imports-graph.ts ../ui/src | pbcopy
```

### Generate .svg file

- install dot graphviz: https://graphviz.org/doc/info/command.html.

```sh
deno run --allow-read ./imports-graph.ts ./ui/src | dot -Tsvg > ./documentation/ui-imports-graph.svg
```

### Import

```ts
import { toDot } from "jsr:@invisement/imports-graph";
```

You may want to use it with viz.js to create the svg file for your webpage.
