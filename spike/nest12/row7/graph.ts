import { FakeListChatModel } from "@langchain/core/utils/testing";
import { END, START, StateGraph } from "@langchain/langgraph";
import { registry } from "@langchain/langgraph/zod";
import { z } from "zod";

/** Graph state as a Zod 4 schema; `steps` uses a reducer to accumulate node names. */
export const AgentState = z.object({
  question: z.string(),
  answer: z.string().default(""),
  steps: z
    .array(z.string())
    .default(() => [])
    .register(registry, {
      reducer: { fn: (left: string[], right: string[]) => left.concat(right) },
    }),
});

/** Builds a two-node graph (ask -> shape) with LangChain's fake chat model; no Nest imports. */
export function buildGraph() {
  const model = new FakeListChatModel({ responses: ["fake answer from the model"] });
  return new StateGraph(AgentState)
    .addNode("ask", async (state) => {
      const reply = await model.invoke(state.question);
      return { answer: String(reply.content), steps: ["ask"] };
    })
    .addNode("shape", (state) => ({ answer: state.answer.toUpperCase(), steps: ["shape"] }))
    .addEdge(START, "ask")
    .addEdge("ask", "shape")
    .addEdge("shape", END)
    .compile();
}
