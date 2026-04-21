const assert = require('node:assert/strict');
const path = require('node:path');

const { FeedSystem } = require(path.join(__dirname, '..', 'feed-service', 'server.js'));

function run() {
  const feed = new FeedSystem();

  const alice = feed.createUser({
    username: 'alice',
    email: 'alice@example.com',
  });
  const bob = feed.createUser({
    username: 'bob',
    email: 'bob@example.com',
  });

  feed.followUser(alice.id, bob.id);
  assert.equal(feed.follows.get(alice.id).has(bob.id), true, 'follow should persist');
  assert.equal(alice.stats.following, 1, 'following count should increase');
  assert.equal(bob.stats.followers, 1, 'follower count should increase');

  feed.unfollowUser(alice.id, bob.id);
  assert.equal(feed.follows.get(alice.id).has(bob.id), false, 'unfollow should remove relation');
  assert.equal(alice.stats.following, 0, 'following count should decrease');
  assert.equal(bob.stats.followers, 0, 'follower count should decrease');

  feed.followUser(alice.id, bob.id);
  feed.followUser(bob.id, alice.id);
  feed.blockUser(alice.id, bob.id);
  assert.equal(feed.blockedUsers.get(alice.id).has(bob.id), true, 'block should persist');
  assert.equal(feed.follows.get(alice.id).has(bob.id), false, 'block should clear following relation');
  assert.equal(feed.follows.get(bob.id).has(alice.id), false, 'block should clear reverse follow relation');

  feed.unblockUser(alice.id, bob.id);
  assert.equal(feed.blockedUsers.get(alice.id).has(bob.id), false, 'unblock should remove block relation');

  console.log('[backend:test:feed] feed core checks passed');
}

run();
