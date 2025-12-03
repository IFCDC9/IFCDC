import { Request, Response } from "express";
import prisma from "../db/client";

export const list = async (req: Request, res: Response) => {
  try {
    const chapters = await prisma.chapter.findMany({
      where: { isActive: true },
      orderBy: { number: "asc" },
    });
    res.json(chapters);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Error fetching chapters" });
  }
};

export const getById = async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const chapter = await prisma.chapter.findUnique({ where: { id } });
    if (!chapter || !chapter.isActive) {
      return res.status(404).json({ message: "Chapter not found" });
    }
    res.json(chapter);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Error fetching chapter" });
  }
};

export const create = async (req: Request, res: Response) => {
  try {
    const { number, title, section, slug, body, version } = req.body;
    const newChapter = await prisma.chapter.create({
      data: { number, title, section, slug, body, version: version || 1 },
    });
    res.status(201).json(newChapter);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Error creating chapter" });
  }
};

export const update = async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const { title, section, body, version, isActive } = req.body;

    const updated = await prisma.chapter.update({
      where: { id },
      data: { title, section, body, version, isActive },
    });

    res.json(updated);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Error updating chapter" });
  }
};
