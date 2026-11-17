import { InMemoryWorkflowStore } from '../mvp-backend/dist/workflow/store.js';

// Loopback-only discovery index. Drafts and full conversations never enter it.
// Local sessions have no verified Zhihu homepage, so they are not contactable.
export class LocalWorkflowStore extends InMemoryWorkflowStore {
  #active = new Map();
  async confirmPaper(input) {
    const paper = await super.confirmPaper(input);
    this.#active.set(paper.id, paper);
    return paper;
  }
  async withdrawPaper(id, ownerId) {
    const paper = await super.withdrawPaper(id, ownerId);
    this.#active.delete(id);
    return paper;
  }
  async list(viewerId, signal) {
    signal.throwIfAborted();
    return [...this.#active.values()].filter(p => p.ownerId !== viewerId && p.status === 'active' && Date.parse(p.discoverableUntil) > Date.now())
      .map(p => ({ candidateId: p.id, authorId: p.ownerId, authorDisplayName: '本地用户', authorProfileUrl: null,
        domain: p.subject, text: `${p.quote}\n${p.context}\n${p.background}`,
        source: { sourceId:p.id, sourceType:'authorized_private', contentType:'authorized_expression', url:null,
          publishedAt:p.confirmedAt, timestampKind:'published', verified:true },
        permission:{discoverable:true,identityDisclosable:false,contactable:false,status:'active'} }));
  }
}
