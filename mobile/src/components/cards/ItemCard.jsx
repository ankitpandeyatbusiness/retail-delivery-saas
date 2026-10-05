import React from 'react';
import BigItemCard from './BigItemCard';
import CompactItemCard from './CompactItemCard';
import GridItemCard from './GridItemCard';

const CARDS = { big: BigItemCard, compact: CompactItemCard, grid: GridItemCard };

function ItemCard({ item, cardStyle, showDot }) {
    const Card = CARDS[cardStyle] || BigItemCard;
    return <Card item={item} showDot={showDot} />;
}

export default React.memo(ItemCard);