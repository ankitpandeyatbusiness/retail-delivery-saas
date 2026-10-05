import React from 'react';
import { useHomeStore } from '../../store/useHomeStore';
import { BLOCKS } from '../../config/blockRegistry';

export default function HomeBlocks() {
    const blocks = useHomeStore((s) => s.config.blocks);
    const end = blocks.indexOf('items');
    const top = end === -1 ? blocks : blocks.slice(0, end);

    return (
        <>
            {top.map((type) => {
                const Block = BLOCKS[type];
                return Block ? <Block key={type} /> : null;
            })}
        </>
    );
}