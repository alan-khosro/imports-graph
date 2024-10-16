# imports-graph
Draw dependency graph for typescript or javascript modules

## Usage
### Output dot notation to stdio/terminal 
``ssh
deno run --allow-read ../imports-graph.ts ../ui/src
```

### Generate .svg file
-   install dot graphviz: https://graphviz.org/doc/info/command.html.

```sh
deno run --allow-read ./imports-graph.ts ./ui/src | dot -Tsvg > ./documentation/ui-imports-graph.svg
```
