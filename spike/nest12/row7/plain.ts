import { buildGraph } from "./graph.js";

const result = await buildGraph().invoke({ question: "what does the owner build?" });
console.log("plain node script ->", JSON.stringify(result));
