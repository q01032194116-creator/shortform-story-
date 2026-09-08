import type { Post } from "../../../src/types";

/** Render the block array roughly as Naver will show it. */
export function Preview({ post }: { post: Post }) {
  const slots = new Map(post.slots.map((s) => [s.slotId, s]));

  return (
    <div className="preview">
      <h1>{post.title}</h1>
      {post.blocks.map((block, i) => {
        switch (block.type) {
          case "heading":
            return <h4 key={i}>{block.text}</h4>;
          case "paragraph":
            return <p key={i}>{block.text}</p>;
          case "quote":
            return <blockquote key={i}>{block.text}</blockquote>;
          case "list":
            return (
              <ul key={i}>
                {block.items.map((item, j) => (
                  <li key={j}>{item}</li>
                ))}
              </ul>
            );
          case "divider":
            return <hr key={i} />;
          case "image": {
            const slot = slots.get(block.slotId);
            const chosen = slot?.candidates.find((c) => c.id === slot.chosenId);
            if (!chosen?.filePath) {
              return (
                <div key={i} className="imgbox">
                  <div className="missing">
                    이미지 없음 — “{block.hint}”에 맞는 사진을 찾지 못했습니다.
                  </div>
                </div>
              );
            }
            return (
              <div key={i} className="imgbox">
                <img src={`/images/${post.id}/${chosen.filePath.split(/[\\/]/).pop()}`} alt={chosen.altText ?? ""} />
                {chosen.caption && <div className="cap">{chosen.caption}</div>}
              </div>
            );
          }
          default:
            return null;
        }
      })}
      <div className="tags">{post.tags.map((t) => `#${t}`).join(" ")}</div>
    </div>
  );
}
