/**
 * Whether a routing key matches a topic binding, as a RabbitMQ topic exchange decides it: words are
 * separated by dots, `*` matches exactly one word, `#` matches zero or more words.
 * `system.ping.*` matches `system.ping.v1`; `content.#` matches `content.published.v1`.
 * @param binding the binding pattern.
 * @param routingKey the message's routing key.
 * @returns true when the message would be routed to a queue with this binding.
 */
export function topicMatches(binding: string, routingKey: string): boolean {
  const match = (pattern: string[], words: string[]): boolean => {
    if (pattern.length === 0) return words.length === 0;
    const [head, ...rest] = pattern;
    if (head === "#") {
      for (let skip = 0; skip <= words.length; skip++) {
        if (match(rest, words.slice(skip))) return true;
      }
      return false;
    }
    if (words.length === 0) return false;
    return (head === "*" || head === words[0]) && match(rest, words.slice(1));
  };
  return match(binding.split("."), routingKey.split("."));
}
