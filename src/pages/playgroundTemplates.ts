export interface PlaygroundTestTemplate {
  id: 'candy' | 'cups';
  title: string;
  prompt: string;
  referenceAnswer: string;
}

/**
 * Reference answers deliberately live beside, rather than inside, each prompt.
 * Template selection only copies `prompt` into the composer, so the answer is
 * visible to the operator but never included in the model request.
 */
export const PLAYGROUND_TEST_TEMPLATES: readonly PlaygroundTestTemplate[] = [
  {
    id: 'candy',
    title: '糖果题',
    prompt: `在一个黑色的袋子里放有三种口味的糖果，每种糖果有两种不同的形状（圆形和五角星形，不同的形状靠手感可以分辨）。现已知不同口味的糖和不同形状的数量统计如下表。参赛者需要在活动前决定摸出的糖果数目，那么，最少取出多少个糖果才能保证手中同时拥有不同形状的苹果味和桃子味的糖？（同时手中有圆形苹果味匹配五角星桃子味糖果，或者有圆形桃子味匹配五角星苹果味糖果都满足要求）
苹果味 桃子味 西瓜味
圆形 7 9 8
五角星形 7 6 4

禁止联网,禁止写代码算出答案.禁止使用外部工具`,
    referenceAnswer: '21',
  },
  {
    id: 'cups',
    title: '水杯题',
    prompt: `有一个水杯配对游戏。共有 4 种不同颜色的水杯，每种颜色各有两个。将同色的两个水杯分别放在上下两层，因此上下两层各有 4 个水杯。
下层 4 个水杯按某个未知顺序排列，挑战者无法看到它们；上层水杯的颜色和位置则完全可见。游戏开始后，挑战者可以反复进行以下操作：
1. 向裁判询问当前有多少个位置满足“上下两个水杯颜色相同”。裁判只回答匹配位置的总数，不透露具体是哪些位置。
2. 根据目前获得的所有信息，挑战者可以选择交换上层任意两个相邻位置的水杯，注意只能是相邻，不能是任意两个。
当 4 个位置全部匹配时，游戏结束。问题：
挑战者应采用何种策略，才能保证对于下层水杯的任意排列都能完成配对？所有能保证成功的策略中，最坏情况所需的交换次数最少是多少？
回答时请不要进行联网搜索，也不要写代码来辅助计算(包括思考过程中)。
假设答案是 x ，你需要给出严格的证明，为什么 x 可行，为什么小于 x 不可行。`,
    referenceAnswer: '8',
  },
];
